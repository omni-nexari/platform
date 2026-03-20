import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SACallerType = 'platform_owner' | 'management_company_admin';

export interface SAUser {
  id: string;
  email: string;
  name: string | null;
  type: SACallerType;
  /** Only set when type === 'management_company_admin' */
  managementCompanyId?: string;
  role?: string;
  companyName?: string | null;
  companySlug?: string | null;
  companyLogoUrl?: string | null;
  companyPortalTitle?: string | null;
  companyFaviconUrl?: string | null;
  companyPrimaryColor?: string | null;
  companyAccentColor?: string | null;
  companySidebarBg?: string | null;
  companyHeadingFontPreset?: 'modern' | 'editorial' | 'geometric' | 'mono' | null;
  companyBodyFontPreset?: 'modern' | 'editorial' | 'geometric' | 'mono' | null;
  companyLoginBackgroundUrl?: string | null;
}

interface SAAuthState {
  accessToken: string | null;
  user: SAUser | null;
  setAuth: (token: string, user: SAUser) => void;
  updateUser: (patch: Partial<SAUser>) => void;
  clearAuth: () => void;
}

export const useSAStore = create<SAAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setAuth: (accessToken, user) => set({ accessToken, user }),
      updateUser: (patch) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...patch } : null,
        })),
      clearAuth: () => set({ accessToken: null, user: null }),
    }),
    { name: 'sa-auth', partialize: (s) => ({ user: s.user }) },
  ),
);

/** Returns true if the currently authenticated admin is a Platform Owner */
export function useIsPlatformOwner() {
  return useSAStore((s) => s.user?.type === 'platform_owner');
}

// ── SA API client ─────────────────────────────────────────────────────────────

const BASE = '/api';

export async function saFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useSAStore.getState().accessToken;
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormDataBody && options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const storeUser = useSAStore.getState().user;
    useSAStore.getState().clearAuth();
    if (storeUser?.type === 'management_company_admin') {
      window.location.href = storeUser.companySlug
        ? `/m/${storeUser.companySlug}/login`
        : '/management/login';
    } else {
      window.location.href = '/superadmin/login';
    }
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
