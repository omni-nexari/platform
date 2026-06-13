import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './auth.js';
import { buildApiUrl } from './api.js';

export type SACallerType = 'management_company_admin';

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
  companyPlan?: 'basic' | 'pro' | null;
}

interface SAAuthState {
  user: SAUser | null;
  bootstrapped: boolean;
  pendingBootstrap: boolean;
  beginBootstrap: () => void;
  setUser: (user: SAUser | null) => void;
  markBootstrapped: () => void;
  updateUser: (patch: Partial<SAUser>) => void;
  clearAuth: () => void;
}

export const useSAStore = create<SAAuthState>()(
  persist(
    (set) => ({
      user: null,
      bootstrapped: false,
      pendingBootstrap: false,
      beginBootstrap: () => set({ user: null, bootstrapped: false, pendingBootstrap: true }),
      setUser: (user) => set({ user, bootstrapped: true, pendingBootstrap: false }),
      markBootstrapped: () => set({ bootstrapped: true, pendingBootstrap: false }),
      updateUser: (patch) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...patch } : null,
        })),
      clearAuth: () => set({ user: null, bootstrapped: true, pendingBootstrap: false }),
    }),
    { name: 'sa-auth', partialize: (s) => ({ user: s.user }) },
  ),
);

/** @deprecated always returns false since platform_owner access was removed */
export function useIsPlatformOwner() {
  return false;
}

// ── SA API client ─────────────────────────────────────────────────────────────

const CSRF_COOKIE = 'sa_csrf_token';

function buildPortalApiUrl(path: string) {
  return buildApiUrl(path);
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function isMutationMethod(method: string | undefined) {
  const normalized = (method ?? 'GET').toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

async function ensurePortalCsrfToken() {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;

  const response = await fetch(buildPortalApiUrl('/superadmin/auth/csrf'), {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok && response.status !== 204) {
    throw new Error('Failed to initialize portal session');
  }

  return readCookie(CSRF_COOKIE);
}

function getPortalLoginPath() {
  const storeUser = useSAStore.getState().user;
  return storeUser?.companySlug ? `/${storeUser.companySlug}/login` : '/management/login';
}

function handlePortalUnauthorized() {
  useSAStore.getState().clearAuth();
  window.location.href = getPortalLoginPath();
}

export async function saFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormDataBody && options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (isMutationMethod(options.method)) {
    const csrfToken = await ensurePortalCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(buildPortalApiUrl(path), { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    handlePortalUnauthorized();
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
  put: <T>(path: string, body?: unknown) =>
    saFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    saFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => saFetch<T>(path, { method: 'DELETE' }),
};

export async function saDownloadBlob(path: string): Promise<Blob> {
  const res = await fetch(buildPortalApiUrl(path), { credentials: 'include' });
  if (res.status === 401) {
    handlePortalUnauthorized();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.blob();
}

export async function saImpersonateOrg(orgId: string) {
  const result = await saApi.post<{
    org: { id: string; name: string; slug: string };
    user: {
      id: string;
      email: string;
      name: string | null;
      role: string;
      impersonatedBy?: string | null;
    };
  }>(`/superadmin/orgs/${orgId}/impersonate`);

  useAuthStore.getState().setUser({
    id: result.user.id,
    name: result.user.name ?? result.user.email,
    email: result.user.email,
    orgRole: result.user.role,
    impersonatedBy: result.user.impersonatedBy ?? null,
  });

  return result;
}
