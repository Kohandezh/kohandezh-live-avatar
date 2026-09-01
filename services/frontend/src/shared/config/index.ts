import { z } from 'zod';

// Single place that reads environment. Fail fast at boot if the build is misconfigured.
// Only VITE_* values exist here and all of them are public: no provider credentials, no LiveKit
// secret, nothing that must not ship in a browser bundle.
const apiBase = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('/') || /^https?:\/\//.test(value), {
    message: 'VITE_API_BASE_URL must be a same-origin path (/api) or an absolute http(s) URL',
  });

const schema = z.object({
  appName: z.string().min(1),
  apiBaseUrl: apiBase,
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
