/// <reference types="vite/client" />
/**
 * Persistent credential store backed by webapis.widgetdata (encrypted, 20 KB limit).
 * Falls back to localStorage for local dev (where widgetdata is undefined).
 */

function useWidgetData(): boolean {
  return typeof webapis !== 'undefined' && webapis.widgetdata != null;
}

export function storeRead(key: string): string | null {
  try {
    if (useWidgetData()) return webapis.widgetdata.read(key);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeWrite(key: string, value: string): void {
  try {
    if (useWidgetData()) { webapis.widgetdata.write(key, value); return; }
    localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

export function storeRemove(key: string): void {
  try {
    if (useWidgetData()) { webapis.widgetdata.remove(key); return; }
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

export function getDeviceToken(): string | null { return storeRead('deviceToken'); }
export function setDeviceToken(t: string): void { storeWrite('deviceToken', t); }

export function getDeviceId(): string | null { return storeRead('deviceId'); }
export function setDeviceId(id: string): void { storeWrite('deviceId', id); }

export function getApiBase(): string {
  return storeRead('apiBase') ?? (import.meta.env['VITE_API_BASE'] as string | undefined) ?? 'http://localhost:3000';
}
export function setApiBase(url: string): void { storeWrite('apiBase', url); }
