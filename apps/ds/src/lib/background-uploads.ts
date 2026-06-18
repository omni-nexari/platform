import { toast } from 'sonner';
import { api } from './api.js';
import { queryClient } from './query-client.js';

export type BackgroundUploadItemStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';
export type BackgroundUploadTaskStatus = 'running' | 'completed' | 'completed-with-errors';

export interface BackgroundUploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: BackgroundUploadItemStatus;
}

export interface BackgroundUploadTask {
  id: string;
  workspaceId: string;
  items: BackgroundUploadItem[];
  status: BackgroundUploadTaskStatus;
  successCount: number;
  failureCount: number;
}

interface ContentItem {
  id: string;
  name: string;
  type: string;
}

const tasks = new Map<string, BackgroundUploadTask>();
const listeners = new Map<string, Set<(task: BackgroundUploadTask) => void>>();

/** Files larger than this are split into chunks to pass through Cloudflare's 100 MB limit. */
const CHUNK_SIZE = 80 * 1024 * 1024; // 80 MB

function cloneTask(task: BackgroundUploadTask): BackgroundUploadTask {
  return {
    ...task,
    items: task.items.map((item) => ({ ...item })),
  };
}

function emit(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return;
  const next = cloneTask(task);
  listeners.get(taskId)?.forEach((listener) => listener(next));
}

function updateTask(taskId: string, updater: (task: BackgroundUploadTask) => void) {
  const task = tasks.get(taskId);
  if (!task) return;
  updater(task);
  emit(taskId);
}

function finishTask(taskId: string, status: BackgroundUploadTaskStatus) {
  updateTask(taskId, (task) => {
    task.status = status;
  });

  window.setTimeout(() => {
    tasks.delete(taskId);
    listeners.delete(taskId);
  }, 5 * 60_000);
}

export function subscribeBackgroundUploadTask(
  taskId: string,
  listener: (task: BackgroundUploadTask) => void,
): () => void {
  const taskListeners = listeners.get(taskId) ?? new Set<(task: BackgroundUploadTask) => void>();
  taskListeners.add(listener);
  listeners.set(taskId, taskListeners);

  const existingTask = tasks.get(taskId);
  if (existingTask) {
    listener(cloneTask(existingTask));
  }

  return () => {
    const current = listeners.get(taskId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(taskId);
    }
  };
}

/**
 * Upload a single file, using chunked multipart requests for files larger than
 * CHUNK_SIZE so they pass through Cloudflare's 100 MB per-request body limit.
 * Progress is reported as a 0–1 fraction of the total file bytes transferred.
 */
async function uploadFileWithProgress(
  apiPath: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  if (file.size <= CHUNK_SIZE) {
    // Single-part upload — existing behaviour
    const form = new FormData();
    form.append('file', file);
    await api.postForm<ContentItem>(apiPath, form, {
      onUploadProgress: (p) => { if (p != null) onProgress(p); },
    });
    return;
  }

  // Multi-part chunked upload
  const uploadId = crypto.randomUUID();
  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  let bytesUploaded = 0;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkSize = end - start;
    // Wrap the slice in a File to preserve the original name + mime type in the
    // multipart form, which the server reads for type detection on the last chunk.
    const chunkFile = new File([file.slice(start, end)], file.name, { type: file.type });
    const form = new FormData();
    form.append('file', chunkFile);

    await api.postForm<unknown>(apiPath, form, {
      headers: {
        'X-Upload-Id': uploadId,
        'X-Chunk-Index': String(i),
        'X-Chunk-Count': String(chunkCount),
      },
      onUploadProgress: (p) => {
        if (p == null) return;
        // Report overall progress capped at 0.99 until all chunks are confirmed.
        onProgress(Math.min((bytesUploaded + chunkSize * p) / file.size, 0.99));
      },
    });

    bytesUploaded += chunkSize;
  }

  onProgress(1);
}

export function startBackgroundDeviceUpload(workspaceId: string, files: File[]): string {
  const taskId = crypto.randomUUID();
  tasks.set(taskId, {
    id: taskId,
    workspaceId,
    items: files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'pending',
    })),
    status: 'running',
    successCount: 0,
    failureCount: 0,
  });
  emit(taskId);

  void (async () => {
    const task = tasks.get(taskId);
    if (!task) return;

    for (const [index, file] of files.entries()) {
      updateTask(taskId, (draft) => {
        draft.items[index]!.status = 'uploading';
        draft.items[index]!.progress = Math.max(draft.items[index]!.progress, 0.02);
      });

      try {
        await uploadFileWithProgress(
          `/content/upload?workspaceId=${workspaceId}`,
          file,
          (progress) => {
            updateTask(taskId, (draft) => {
              draft.items[index]!.status = 'uploading';
              draft.items[index]!.progress = progress;
            });
          },
        );

        updateTask(taskId, (draft) => {
          draft.items[index]!.status = 'uploaded';
          draft.items[index]!.progress = 1;
          draft.successCount += 1;
        });
      } catch {
        updateTask(taskId, (draft) => {
          draft.items[index]!.status = 'failed';
          draft.items[index]!.progress = 1;
          draft.failureCount += 1;
        });
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['content', workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ['picker-content', workspaceId] });

    const completedTask = tasks.get(taskId);
    if (!completedTask) return;

    if (completedTask.failureCount > 0) {
      toast.error(`Uploaded ${completedTask.successCount} file${completedTask.successCount === 1 ? '' : 's'}, ${completedTask.failureCount} failed`);
      finishTask(taskId, 'completed-with-errors');
      return;
    }

    toast.success(`Uploaded ${completedTask.successCount} file${completedTask.successCount === 1 ? '' : 's'}`);
    finishTask(taskId, 'completed');
  })();

  return taskId;
}