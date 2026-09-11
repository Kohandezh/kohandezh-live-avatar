/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_ENV?: 'development' | 'staging' | 'production';
  /** "true" enables the local mock API (src/data/mock). */
  readonly VITE_API_MOCK?: string;
  /** Injected at build time by vite.config.ts. "test" under Vitest. */
  readonly VITE_APP_TARGET: 'mobile' | 'web' | 'admin' | 'widget' | 'test';
}
