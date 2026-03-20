import { useAuthStore } from './auth.js';

const BASE = '/api';

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
  token: string | null | undefined,
  options: FormRequestOptions = {},
): Promise<FormRequestResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.withCredentials = true;

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
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
  const token = useAuthStore.getState().accessToken;
  let result = await performFormRequest(path, form, token, options);

  if (result.status === 401) {
    const refreshed = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) {
      const data = (await refreshed.json()) as { accessToken: string };
      useAuthStore.getState().setAuth(data.accessToken, useAuthStore.getState().user);
      result = await performFormRequest(path, form, data.accessToken, options);
    } else {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
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
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    // Only set JSON content-type for string bodies; FormData sets its own boundary.
    ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    // Try token refresh
    const refreshed = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshed.ok) {
      const data = (await refreshed.json()) as { accessToken: string };
      useAuthStore.getState().setAuth(data.accessToken, useAuthStore.getState().user);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      const retry = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });
      if (!retry.ok) throw new Error(await retry.text());
      return retry.json() as Promise<T>;
    } else {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
    }
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
