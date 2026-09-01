import { config } from '@shared/config';
import { isNative } from '@shared/platform/isNative';
import { tokenStorage } from '@shared/storage/token';
import { ApiError, codeFromStatus, type ApiErrorBody } from './errors';

// The ONLY place in the app that calls fetch. Owns: base URL, auth header/cookies, JSON handling,
// timeouts, error normalization. Pages/features/entities consume typed functions built on it.

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Skip attaching credentials (public endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

let onUnauthorized: (() => void) | null = null;
/** Registered once by the auth feature so a 401 can clear session state. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), config.apiBaseUrl.replace(/\/?$/, '/'));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  // Web: HttpOnly cookie carries the session (credentials: 'include').
  // Native: Bearer token from secure storage. Both resolve to the same identity server-side.
  if (!opts.anonymous && isNative()) {
    const token = await tokenStorage.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: isNative() || opts.anonymous ? 'omit' : 'include',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'Request timed out');
    throw new ApiError(0, 'NETWORK', 'Network request failed');
  }
  clearTimeout(timeout);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    const body = json as Partial<ApiErrorBody> | null;
    const code = codeFromStatus(res.status);
    if (code === 'UNAUTHORIZED') onUnauthorized?.();
    throw new ApiError(
      res.status,
      code,
      body?.error?.message ?? res.statusText ?? 'Request failed',
      body?.error?.code,
      body?.error?.details,
    );
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
