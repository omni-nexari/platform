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
        const form = new FormData();
        form.append('file', file);
        await api.postForm<ContentItem>(`/content/upload?workspaceId=${workspaceId}`, form, {
          onUploadProgress: (progress) => {
            if (progress == null) return;
            updateTask(taskId, (draft) => {
              draft.items[index]!.status = 'uploading';
              draft.items[index]!.progress = progress;
            });
          },
        });

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