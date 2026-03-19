import { getDeviceToken, getApiBase } from '../store.js';

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getDeviceToken();
  const base = getApiBase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${base}${path}`, { ...options, headers });
}
