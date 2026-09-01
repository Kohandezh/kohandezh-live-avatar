import { config } from '@shared/config';
import { ApiError, codeFromStatus, type ApiErrorBody } from './errors';

// The ONLY place in the app that calls fetch. Owns: base URL, credential transport, headers,
// timeouts, JSON/binary handling and error normalization. Pages/features/entities consume typed
// functions built on it (see avatar.ts, assets.ts, health.ts).
//
// Authentication is intentionally NOT implemented in Phase 1. The transport hook below is the
// single seam where the future model plugs in without touching feature code:
//   Web:    HttpOnly Secure SameSite cookie -> `credentials: 'include'`, nothing to add here.
//   Native: Bearer token from platform secure storage -> provider returns the Authorization header.
// The browser must never see the LiveKit server secret or provider credentials; the only
// token it handles is the scoped LiveKit browser token returned by POST /avatar/session, which
// is consumed by the LiveKit SDK and never persisted or logged.

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CredentialsProvider = () => Promise<Record<string, string>>;

let credentialsProvider: CredentialsProvider | null = null;
/** Future auth hook: registered once at boot; returns extra headers (e.g. Authorization). */
export function setCredentialsProvider(provider: CredentialsProvider | null): void {
  credentialsProvider = provider;
}

let onUnauthorized: (() => void) | null = null;
/** Future auth hook: lets a session feature react to 401 without every caller checking. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Absolute API base, resolved against the current origin when configured as a path. */
export function apiBaseUrl(): string {
  const base = config.apiBaseUrl.replace(/\/?$/, '/');
  if (/^https?:\/\//.test(base)) return base;
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
  return new URL(base, origin).toString();
}

/** Absolute URL for an API path. Used for media `src`/download links, never for secrets. */
export function apiUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), apiBaseUrl());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** ws(s):// URL for an API WebSocket path, derived from the same base as HTTP requests. */
export function apiWsUrl(path: string): string {
  const url = new URL(apiUrl(path));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

interface RawResponse {
  res: Response;
  timeout: ReturnType<typeof setTimeout>;
}

async function send(path: string, opts: RequestOptions, accept: string): Promise<RawResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const headers: Record<string, string> = { Accept: accept, ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (credentialsProvider) Object.assign(headers, await credentialsProvider());

  try {
    const res = await fetch(apiUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    return { res, timeout };
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'Request timed out');
    throw new ApiError(0, 'NETWORK', 'Network request failed');
  }
}

async function throwForStatus(res: Response): Promise<never> {
  const text = await res.text();
  const body = (text ? safeJson(text) : null) as Partial<ApiErrorBody> | null;
  const code = codeFromStatus(res.status);
  if (code === 'UNAUTHORIZED') onUnauthorized?.();
  throw new ApiError(res.status, code, body?.error?.message ?? res.statusText ?? 'Request failed', {
    serverCode: body?.error?.code,
    details: body?.error?.details,
    correlationId: body?.correlation_id,
    retryable: body?.error?.retryable,
  });
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { res, timeout } = await send(path, opts, 'application/json');
  try {
    if (!res.ok) await throwForStatus(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? safeJson(text) : null) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** Binary GET (raw PCM audio). Same error normalization as JSON requests. */
export async function requestBinary(
  path: string,
  opts: Omit<RequestOptions, 'method' | 'body'> = {},
): Promise<ArrayBuffer> {
  const { res, timeout } = await send(path, { ...opts, method: 'GET' }, '*/*');
  try {
    if (!res.ok) await throwForStatus(res);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
  binary: requestBinary,
};
