/**
 * Typed access to build-time configuration.
 * Read environment values here, not with import.meta.env in feature code.
 */
export type AppTarget = 'mobile' | 'web' | 'admin' | 'widget' | 'test';

export const env = {
  /** Which app was built: mobile (Capacitor), web (PWA), admin, or the website widget. */
  appTarget: import.meta.env.VITE_APP_TARGET as AppTarget,
  appEnv: import.meta.env.VITE_APP_ENV ?? 'development',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  /** When true, API calls are answered by src/data/mock instead of a backend. */
  apiMock: import.meta.env.VITE_API_MOCK === 'true',
  /**
   * URL of the idle-preview video loop for the video conversation screen. `null` when unset,
   * which is the normal case until a real preview file is produced: `ConversationStage` renders
   * `AmbientStage` instead. Setting the env value is the only change needed once the file exists.
   */
  assistantPreviewVideo: import.meta.env.VITE_ASSISTANT_PREVIEW_VIDEO ?? null,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;
