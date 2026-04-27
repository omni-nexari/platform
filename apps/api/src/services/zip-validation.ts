/**
 * ZIP validation — defends against zip-slip and zip-bomb attacks on HTML5
 * package uploads. All checks run against the on-disk file using `adm-zip`
 * (already a dependency).
 *
 * Returns null when valid, or a string error message describing the rejection.
 */

import path from 'node:path';

export interface ZipValidationOptions {
  maxUncompressedBytes?: number; // total expanded size cap
  maxFileCount?: number;         // entry count cap
}

export interface ZipValidationResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_FILES = 1000;

export async function validateZip(
  absPath: string,
  opts: ZipValidationOptions = {},
): Promise<ZipValidationResult> {
  const maxBytes = opts.maxUncompressedBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = opts.maxFileCount ?? DEFAULT_MAX_FILES;

  // adm-zip uses CommonJS `export =`; the `.default` interop is provided by
  // esModuleInterop at runtime but isn't visible to TS at the type level.
  // Avoid pinning a type expression and treat the constructor opaquely.
  let AdmZipCtor: new (p?: string) => {
    getEntries(): Array<{ entryName: string; isDirectory: boolean; header: { size?: number } }>;
  };
  try {
    AdmZipCtor = ((await import('adm-zip')) as unknown as { default: typeof AdmZipCtor }).default;
  } catch {
    return { ok: false, error: 'ZIP validator unavailable' };
  }

  let zip: InstanceType<typeof AdmZipCtor>;
  try {
    zip = new AdmZipCtor(absPath);
  } catch {
    return { ok: false, error: 'Not a valid ZIP archive' };
  }

  const entries = zip.getEntries();

  if (entries.length > maxFiles) {
    return { ok: false, error: `ZIP contains ${entries.length} files (max ${maxFiles})` };
  }

  let totalUncompressed = 0;
  for (const e of entries) {
    const entryName = e.entryName;

    // 1. Reject absolute paths (POSIX or Windows drive)
    if (entryName.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entryName)) {
      return { ok: false, error: `Absolute path inside ZIP: ${entryName}` };
    }

    // 2. Reject path traversal — `..` segments
    const norm = path.posix.normalize(entryName.replace(/\\/g, '/'));
    if (norm.startsWith('..') || norm.includes('/../')) {
      return { ok: false, error: `Path traversal inside ZIP: ${entryName}` };
    }

    // 3. Reject NUL byte injection
    if (entryName.includes('\0')) {
      return { ok: false, error: `Null byte in ZIP entry name` };
    }

    // 4. Track uncompressed size — header.size is reported by adm-zip
    const declared = (e.header as { size?: number }).size ?? 0;
    totalUncompressed += declared;
    if (totalUncompressed > maxBytes) {
      return { ok: false, error: `ZIP uncompressed size exceeds ${maxBytes} bytes` };
    }
  }

  return { ok: true };
}
