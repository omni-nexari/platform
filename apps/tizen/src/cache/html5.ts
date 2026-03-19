/**
 * HTML5 zip bundle cache module.
 *
 * Downloads and extracts HTML5 content packages (zip files) to Tizen's
 * wgt-private storage so they can be served locally in an iframe.
 *
 * Flow:
 *   1. downloadAndExtract(contentId, downloadUrl) — download zip then extract
 *   2. getExtractedUrl(contentId) — get local file:// URL to index.html
 *   3. deleteBundle(contentId) — evict from cache
 */

import JSZip from 'jszip';

const EXTRACT_ROOT = 'wgt-private/html5';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Download a zip from the given URL, extract it to wgt-private/html5/<contentId>/,
 * and return the file:// URL to its index.html.
 */
export async function downloadAndExtract(
  contentId: string,
  downloadUrl: string,
): Promise<string> {
  // Step 1: fetch zip as ArrayBuffer (Tizen supports XHR with file:// and https://)
  const zipBuffer = await fetchArrayBuffer(downloadUrl);

  // Step 2: parse with JSZip
  const zip = await JSZip.loadAsync(zipBuffer);

  // Step 3: ensure extraction directory
  const extractPath = `${EXTRACT_ROOT}/${contentId}`;
  await mkdirp(extractPath);

  // Step 4: write all files concurrently
  const writes: Promise<void>[] = [];
  zip.forEach((relativePath: string, entry: JSZip.JSZipObject) => {
    if (!entry.dir) {
      writes.push(
        entry.async('uint8array').then((data: Uint8Array) =>
          writeTizenFile(`${extractPath}/${relativePath}`, data),
        ),
      );
    }
  });
  await Promise.all(writes);

  // Step 5: return URI to index.html
  return resolveUri(`${extractPath}/index.html`);
}

/**
 * Return the cached file:// URL for an already-extracted bundle,
 * or null if not yet downloaded.
 */
export function getExtractedUrl(contentId: string): Promise<string | null> {
  return new Promise((resolve) => {
    tizen.filesystem.resolve(
      EXTRACT_ROOT,
      (rootDir) => {
        try {
          const subDir = rootDir.resolve(contentId) as FileSystemDirectory;
          const indexFile = subDir.resolve('index.html') as FileSystemFile;
          resolve(indexFile.toURI());
        } catch {
          resolve(null);
        }
      },
      () => resolve(null),
      'r',
    );
  });
}

/** Remove a previously extracted bundle from storage. */
export function deleteBundle(contentId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve(
      EXTRACT_ROOT,
      (rootDir) => {
        try {
          (rootDir as FileSystemDirectory).deleteDirectory(
            `${EXTRACT_ROOT}/${contentId}`,
            true,
            resolve,
            (e) => reject(new Error(String(e))),
          );
        } catch {
          // Directory might not exist — treat as success
          resolve();
        }
      },
      () => resolve(), // root dir doesn't exist yet — nothing to delete
      'rw',
    );
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer);
      } else {
        reject(new Error(`HTTP ${xhr.status} fetching ${url}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network error fetching ${url}`));
    xhr.send();
  });
}

/** Recursively create a directory path inside wgt-private. */
function mkdirp(virtualPath: string): Promise<void> {
  // virtualPath format: "wgt-private/html5/contentId/..."
  const segments = virtualPath.split('/');
  const root = segments[0]!;          // 'wgt-private'
  const rest = segments.slice(1);     // ['html5', 'contentId', ...]

  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve(
      root,
      (rootDir) => {
        try {
          ensureDirs(rootDir as FileSystemDirectory, rest);
          resolve();
        } catch (e) {
          reject(e);
        }
      },
      (e) => reject(new Error(String(e))),
      'rw',
    );
  });
}

function ensureDirs(parent: FileSystemDirectory, parts: string[]): FileSystemDirectory {
  if (parts.length === 0) return parent;
  const name = parts[0]!;
  let child: FileSystemDirectory;
  try {
    child = parent.createDirectory(name);
  } catch {
    // Already exists
    child = parent.resolve(name) as FileSystemDirectory;
  }
  return ensureDirs(child, parts.slice(1));
}

/** Write a Uint8Array to a Tizen virtual-path location. */
function writeTizenFile(virtualPath: string, data: Uint8Array): Promise<void> {
  const parts        = virtualPath.split('/');
  const fileName     = parts.pop()!;
  const root         = parts[0]!;
  const dirParts     = parts.slice(1);

  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve(
      root,
      (rootDir) => {
        try {
          const dir  = ensureDirs(rootDir as FileSystemDirectory, dirParts);
          const file = dir.createFile(fileName);
          file.openStream(
            'w',
            (stream) => {
              stream.writeBytes(Array.from(data));
              stream.close();
              resolve();
            },
            (e) => reject(new Error(String(e))),
          );
        } catch (e) {
          reject(e);
        }
      },
      (e) => reject(new Error(String(e))),
      'rw',
    );
  });
}

/** Resolve a virtual path to a file:// URI. */
function resolveUri(virtualPath: string): Promise<string> {
  const parts  = virtualPath.split('/');
  const root   = parts[0]!;
  const relPath = parts.slice(1).join('/');

  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve(
      root,
      (rootDir) => {
        try {
          const file = rootDir.resolve(relPath) as FileSystemFile;
          resolve(file.toURI());
        } catch (e) {
          reject(e);
        }
      },
      (e) => reject(new Error(String(e))),
      'r',
    );
  });
}
