import { useAuthStore } from './auth.js';

let refreshSessionPromise: Promise<void> | null = null;
let lastRefreshFailureAt = 0;
const REFRESH_FAILURE_COOLDOWN_MS = 5_000;

function resolveApiBase() {
  return '/api';
}

const BASE = resolveApiBase();

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function readCookie(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function isMutationMethod(method: string | undefined) {
  const normalized = (method ?? 'GET').toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

function resolveBaseUrl() {
  if (BASE.startsWith('http://') || BASE.startsWith('https://')) {
    return BASE.endsWith('/') ? BASE : `${BASE}/`;
  }

  return new URL(BASE.endsWith('/') ? BASE : `${BASE}/`, window.location.origin).toString();
}

function isAuthMeNotFound(text: string) {
  return text.includes('User not found') || text.includes('Org not found');
}

function clearInvalidSession() {
  useAuthStore.getState().clearAuth();
  if (window.location.pathname !== '/login' && window.location.pathname !== '/login/2fa') {
    window.location.href = '/login';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCsrfToken() {
  if (readCookie('csrf_token')) return readCookie('csrf_token');
  await fetch(buildApiUrl('/auth/csrf'), { credentials: 'include' });
  return readCookie('csrf_token');
}

export function buildApiUrl(path: string) {
  return new URL(normalizePath(path).slice(1), resolveBaseUrl()).toString();
}

export function buildWebSocketUrl(path: string) {
  const httpUrl = new URL(buildApiUrl(path));
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString();
}

async function refreshSession(): Promise<void> {
  if (refreshSessionPromise) return refreshSessionPromise;

  const now = Date.now();
  if (lastRefreshFailureAt && now - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS) {
    clearInvalidSession();
    throw new Error('Unauthorized');
  }

  refreshSessionPromise = (async () => {
    const csrfToken = await ensureCsrfToken();
    const refreshResponse = await fetch(buildApiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    });

    if (!refreshResponse.ok) {
      lastRefreshFailureAt = Date.now();
      clearInvalidSession();
      throw new Error('Unauthorized');
    }

    lastRefreshFailureAt = 0;
  })().finally(() => {
    refreshSessionPromise = null;
  });

  return refreshSessionPromise;
}

type FormRequestOptions = {
  onUploadProgress?: (progress: number | null) => void;
};

type FormRequestResult = {
  status: number;
  text: string;
};

function parseResponseText<T>(status: number, text: string): T {
  if (status === 204 || !text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

function performFormRequest(
  path: string,
  form: FormData,
  csrfToken: string | null | undefined,
  options: FormRequestOptions = {},
): Promise<FormRequestResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildApiUrl(path));
    xhr.withCredentials = true;

    if (csrfToken) {
      xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    }

    xhr.upload.onprogress = (event) => {
      if (!options.onUploadProgress) return;
      options.onUploadProgress(event.lengthComputable ? event.loaded / event.total : null);
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText ?? '' });
    xhr.send(form);
  });
}

async function postFormRequest<T>(
  path: string,
  form: FormData,
  options: FormRequestOptions = {},
): Promise<T> {
  const csrfToken = await ensureCsrfToken();
  let result = await performFormRequest(path, form, csrfToken, options);

  if (result.status === 401) {
    await refreshSession();
    const nextCsrfToken = await ensureCsrfToken();
    result = await performFormRequest(path, form, nextCsrfToken, options);
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(result.text || `Request failed with status ${result.status}`);
  }

  return parseResponseText<T>(result.status, result.text);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    // Only set JSON content-type for string bodies; FormData sets its own boundary.
    ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (isMutationMethod(options.method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(buildApiUrl(path), { ...options, headers, credentials: 'include' });

  if (path === '/auth/me' && res.status === 404) {
    const notFoundText = await res.text();
    if (isAuthMeNotFound(notFoundText)) {
      clearInvalidSession();
      throw new Error(notFoundText);
    }

    await sleep(150);
    const retryAfterDelay = await fetch(buildApiUrl(path), { ...options, headers, credentials: 'include' });
    if (retryAfterDelay.ok) {
      if (retryAfterDelay.status === 204) return undefined as T;
      return retryAfterDelay.json() as Promise<T>;
    }

    const retryAfterDelayText = await retryAfterDelay.text();
    if (retryAfterDelay.status === 404 && isAuthMeNotFound(retryAfterDelayText)) {
      clearInvalidSession();
      throw new Error(retryAfterDelayText);
    }

    if (retryAfterDelay.status !== 404 && retryAfterDelay.status !== 401) {
      throw new Error(retryAfterDelayText);
    }
  }

  // Auth endpoints that establish or teardown sessions should not trigger a
  // session-refresh retry — they have no active session to recover.
  const isAuthEndpoint = path === '/auth/login'
    || path === '/auth/login/2fa'
    || path === '/auth/refresh'
    || path === '/auth/logout'
    || path === '/auth/csrf'
    || path === '/auth/session/bootstrap';

  if (!isAuthEndpoint && (res.status === 401 || (path === '/auth/me' && res.status === 404))) {
    await refreshSession();
    if (isMutationMethod(options.method)) {
      const nextCsrfToken = await ensureCsrfToken();
      if (nextCsrfToken) headers['X-CSRF-Token'] = nextCsrfToken;
    }
    const retry = await fetch(buildApiUrl(path), { ...options, headers, credentials: 'include' });
    if (!retry.ok) {
      const retryText = await retry.text();
      if (retry.status === 401 || (path === '/auth/me' && retry.status === 404 && isAuthMeNotFound(retryText))) {
        clearInvalidSession();
      }
      throw new Error(retryText);
    }
    if (retry.status === 204) return undefined as T;
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  /** Upload multipart FormData — do NOT set Content-Type, the browser sets it with the boundary. */
  postForm: <T>(path: string, form: FormData, options?: FormRequestOptions) =>
    postFormRequest<T>(path, form, options),
};
