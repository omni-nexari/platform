import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SAAuthState {
  accessToken: string | null;
  user: { id: string; email: string; name: string | null } | null;
  setAuth: (token: string, user: SAAuthState['user']) => void;
  clearAuth: () => void;
}

export const useSAStore = create<SAAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setAuth: (accessToken, user) => set({ accessToken, user }),
      clearAuth: () => set({ accessToken: null, user: null }),
    }),
    { name: 'sa-auth', partialize: (s) => ({ user: s.user }) },
  ),
);

// ── SA API client ─────────────────────────────────────────────────────────────

const BASE = '/api';

export async function saFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useSAStore.getState().accessToken;
  const headers: Record<string, string> = {
    ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    useSAStore.getState().clearAuth();
    window.location.href = '/superadmin/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const saApi = {
  get: <T>(path: string) => saFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    saFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    saFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => saFetch<T>(path, { method: 'DELETE' }),
};
