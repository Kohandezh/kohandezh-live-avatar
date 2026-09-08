import { env } from '../config/env';

/**
 * URL helpers for cases axios cannot cover: media `src` attributes, download links, and
 * WebSocket endpoints. Never put a secret in one of these; they end up in the DOM.
 */

/**
 * Absolute API base, resolved against the current origin when configured as a path.
 * The `/api` prefix belongs to the request path, not to this base (see entities/user/api.ts).
 */
export function apiBaseUrl(): string {
  const base = (env.apiBaseUrl || '/').replace(/\/?$/, '/');
  if (/^https?:\/\//.test(base)) return base;
  const origin =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'http://localhost';
  return new URL(base, origin).toString();
}

/** Absolute URL for an API path. Used for media `src` and download links. */
export function apiUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path.replace(/^\//, ''), apiBaseUrl());
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
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
