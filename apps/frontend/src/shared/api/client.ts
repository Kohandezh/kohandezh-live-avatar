import axios from 'axios';
import { env } from '../config/env';
import {
  attachAuthInterceptor,
  attachEmbedKeyInterceptor,
  attachErrorInterceptor,
  setEmbedKey,
} from './interceptors';

/**
 * The single API client. All backend calls go through it.
 * Do not create another axios instance and do not call fetch directly.
 */
export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  // Web auth uses HttpOnly cookies (ADR 0002). This sends them cross-origin.
  // The backend must answer with explicit CORS origins and
  // Access-Control-Allow-Credentials: true.
  withCredentials: true,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

attachAuthInterceptor(apiClient);
attachEmbedKeyInterceptor(apiClient);
attachErrorInterceptor(apiClient);

export interface ApiClientConfig {
  /** Backend origin, or "" when the API is served from the same origin as the page. */
  baseURL: string;
  /** Public embed key sent as `X-Embed-Key` (ADR 0010). Not a secret, not a user session. */
  embedKey: string;
}

/**
 * Points the shared client at a backend given at runtime and makes it authenticate with a
 * public embed key instead of a user session. The website widget calls this before it mounts;
 * no other target does (ADR 0010).
 *
 * Cookies are turned off on purpose. The widget runs on the customer's origin, where a
 * visitor may already be logged in to our app in another tab. Sending their session cookie
 * would mix a real user with the anonymous embed principal on the backend.
 */
export function configureApiClient({
  baseURL,
  embedKey,
}: ApiClientConfig): void {
  apiClient.defaults.baseURL = baseURL;
  apiClient.defaults.withCredentials = false;
  setEmbedKey(embedKey);
}
