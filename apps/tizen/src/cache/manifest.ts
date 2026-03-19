/** Content manifest — tracks cached files and SHA-256 integrity hashes. */

interface ManifestEntry {
  contentId: string;
  fileName: string;
  sha256: string;
  cachedAt: number;
}

const MANIFEST_KEY = 'cache_manifest';

function loadManifest(): Record<string, ManifestEntry> {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ManifestEntry>) : {};
  } catch { return {}; }
}

function saveManifest(m: Record<string, ManifestEntry>): void {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
}

export function recordCached(entry: ManifestEntry): void {
  const m = loadManifest();
  m[entry.contentId] = entry;
  saveManifest(m);
}

export function isCached(contentId: string): boolean {
  return !!loadManifest()[contentId];
}

export function getCachedPath(contentId: string): string | null {
  const entry = loadManifest()[contentId];
  return entry ? `wgt-private/${contentId}/${entry.fileName}` : null;
}

export async function verifyIntegrity(contentId: string, data: ArrayBuffer): Promise<boolean> {
  const entry = loadManifest()[contentId];
  if (!entry) return false;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === entry.sha256;
}

export function clearAll(): void {
  localStorage.removeItem(MANIFEST_KEY);
}
