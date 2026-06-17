/**
 * store.ts — Simple JSON-file config store for the Windows player.
 * Replaces electron-store (ESM-only v10 incompatible with CJS main process).
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export function getDefaultApiBase(): string {
  const configured = process.env.NEXARI_PLAYER_API_BASE ?? process.env.PLAYER_API_BASE;
  const normalized = configured?.trim().replace(/\/$/, '');
  if (normalized) return normalized;

  return process.env.NEXARI_DEV === '1'
    ? 'http://192.168.1.17/api/v1'
    : 'https://ds.chiho.app/api/v1';
}

export interface StoreSchema {
  deviceToken: string;
  deviceId: string;
  apiBase: string;
  /** PIN to exit kiosk / replace-shell mode. SHA-256 hex. */
  kioskPinHash: string;
  workspaceId: string;
  groupId: string;
  /** Per-device Windows player settings (mirrors API columns; see WindowsPlayerSettings in shared). */
  windowsSettings: Record<string, unknown>;
}

const DEFAULTS: StoreSchema = {
  deviceToken: '',
  deviceId: '',
  apiBase: getDefaultApiBase(),
  kioskPinHash: '',
  workspaceId: '',
  groupId: '',
  windowsSettings: {},
};

class JsonStore {
  private _path: string;
  private _data: StoreSchema;

  constructor() {
    const dir = app.getPath('userData');
    this._path = path.join(dir, 'nexari-config.json');
    this._data = { ...DEFAULTS };
    this._load();
  }

  private _load(): void {
    try {
      const raw = fs.readFileSync(this._path, 'utf8');
      this._data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* first run or corrupt — use defaults */ }
  }

  private _save(): void {
    try { fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf8'); } catch { /* ignore */ }
  }

  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this._data[key];
  }

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this._data[key] = value;
    this._save();
  }
}

let _store: JsonStore | null = null;

export function getStore(): JsonStore {
  if (!_store) _store = new JsonStore();
  return _store;
}
