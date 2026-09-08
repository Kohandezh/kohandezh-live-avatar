import axios from 'axios';
import { env } from '../config/env';
import { attachAuthInterceptor, attachErrorInterceptor } from './interceptors';

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
attachErrorInterceptor(apiClient);
