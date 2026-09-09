/**
 * Typed access to build-time configuration.
 * Read environment values here, not with import.meta.env in feature code.
 */
export type AppTarget = 'mobile' | 'web' | 'admin' | 'test';

export const env = {
  /** Which app was built: mobile (Capacitor), web (PWA), or admin. */
  appTarget: import.meta.env.VITE_APP_TARGET as AppTarget,
  appEnv: import.meta.env.VITE_APP_ENV ?? 'development',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  /** When true, API calls are answered by src/data/mock instead of a backend. */
  apiMock: import.meta.env.VITE_API_MOCK === 'true',
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;
