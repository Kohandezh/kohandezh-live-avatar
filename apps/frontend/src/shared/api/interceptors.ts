import type { AxiosInstance } from 'axios';
import { isNative } from '../platform';
import { getAccessToken } from '../storage/tokenStore';
import { toApiError } from './errors';

/**
 * Adds `Authorization: Bearer <token>` when a token exists (native), and
 * `X-Client-Platform` so the backend knows whether to set a cookie or return
 * a bearer token from /api/auth/otp/verify.
 */
export function attachAuthInterceptor(client: AxiosInstance): void {
  client.interceptors.request.use(async (config) => {
    const token = await getAccessToken();

    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

    config.headers.set('X-Client-Platform', isNative() ? 'native' : 'web');

    return config;
  });
}

/**
 * The public embed key of the website widget, or null in every other target.
 * Module state, not a second client: all targets share one axios instance.
 */
let embedKey: string | null = null;

/** Set by `configureApiClient`. Only the widget target ever calls it. */
export function setEmbedKey(key: string | null): void {
  embedKey = key;
}

/**
 * Adds `X-Embed-Key` when an embed key is configured. The mobile, web and admin targets
 * never configure one, so their requests keep the exact headers they had before.
 */
export function attachEmbedKeyInterceptor(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    if (embedKey) config.headers.set('X-Embed-Key', embedKey);
    return config;
  });
}

/** Turns every failed response into an ApiError so callers handle one shape. */
export function attachErrorInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => Promise.reject(toApiError(error)),
  );
}
