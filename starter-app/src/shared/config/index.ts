import { z } from 'zod';

// Single place that reads environment. Fail fast at boot if the build is misconfigured.
const schema = z.object({
  appName: z.string().min(1),
  apiBaseUrl: z.string().url(),
  env: z.enum(['development', 'staging', 'production']),
  devtools: z.boolean(),
});

export const config = schema.parse({
  appName: import.meta.env.VITE_APP_NAME,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  env: import.meta.env.VITE_ENV,
  devtools: import.meta.env.VITE_ENABLE_DEVTOOLS === 'true',
});

export type AppConfig = typeof config;
