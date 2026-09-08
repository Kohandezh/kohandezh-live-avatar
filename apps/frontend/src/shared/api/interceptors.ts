import type { AxiosInstance } from 'axios';
import { getAccessToken } from '../storage/tokenStore';
import { toApiError } from './errors';

/** Adds `Authorization: Bearer <token>` when a token exists (native). */
export function attachAuthInterceptor(client: AxiosInstance): void {
  client.interceptors.request.use(async (config) => {
    const token = await getAccessToken();

    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

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
