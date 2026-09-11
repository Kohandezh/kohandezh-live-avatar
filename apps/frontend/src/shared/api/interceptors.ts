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

/** Turns every failed response into an ApiError so callers handle one shape. */
export function attachErrorInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => Promise.reject(toApiError(error)),
  );
}
