import { z } from 'zod';
import type { AssistantMode } from '@/features/assistant';
import { detectLanguage, type SupportedLanguage } from '@/i18n';

/** Which side of the viewport the launcher sits on. Logical, so `end` flips in RTL. */
export type WidgetPosition = 'start' | 'end';

/** What a customer passes to `window.KohandezhAssistant.init(...)`. */
export interface AssistantWidgetOptions {
  /** Backend origin, for example `https://api.example.com`. Empty means the same origin. */
  apiBaseUrl: string;
  /** Public embed key. The backend pairs it with an origin allowlist (ADR 0010). */
  embedKey: string;
  language?: SupportedLanguage;
  mode?: AssistantMode;
  position?: WidgetPosition;
  /** Open the panel right away instead of showing only the launcher. */
  open?: boolean;
}

/** Options after validation and defaults. This is what the React tree reads. */
export interface WidgetConfig {
  apiBaseUrl: string;
  embedKey: string;
  language: SupportedLanguage;
  mode: AssistantMode;
  position: WidgetPosition;
  open: boolean;
}

/**
 * Either empty (same origin), an absolute http(s) URL, or a path prefix such as `/api-proxy`.
 * Anything else is a typo in the embed snippet, and a clear error beats a failed request.
 */
const apiBaseUrlSchema = z
  .string()
  .refine(
    (value) =>
      value === '' || value.startsWith('/') || /^https?:\/\//.test(value),
    { message: 'apiBaseUrl must be empty, a path, or an http(s) URL' },
  );

const optionsSchema = z.object({
  apiBaseUrl: apiBaseUrlSchema.default(''),
  embedKey: z.string().min(1),
  language: z.enum(['en', 'fa']).optional(),
  mode: z.enum(['voice', 'video']).optional(),
  position: z.enum(['start', 'end']).optional(),
  open: z.boolean().optional(),
});

/**
 * Validates whatever the host page passed and fills in the defaults.
 * Throws with a readable message, because the reader is the developer who wrote the snippet.
 */
export function resolveWidgetOptions(input: unknown): WidgetConfig {
  const result = optionsSchema.safeParse(input);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid options: ${problems}`);
  }

  const options = result.data;

  return {
    apiBaseUrl: options.apiBaseUrl,
    embedKey: options.embedKey,
    // No language given: follow the visitor's browser, like the app does.
    language: options.language ?? detectLanguage(),
    mode: options.mode ?? 'voice',
    position: options.position ?? 'end',
    open: options.open ?? false,
  };
}

/**
 * Reads the options a customer wrote as data attributes on the script tag:
 *
 *   <script src="assistant-widget.js" data-api-base="https://api.example.com"
 *           data-embed-key="..." data-lang="fa" data-mode="voice" data-position="end"></script>
 *
 * Returns null when the tag carries no embed key, which means the page wants to call
 * `init()` itself. The values are not validated here; `resolveWidgetOptions` does that.
 */
export function readScriptOptions(
  script: HTMLScriptElement,
): Record<string, string> | null {
  const data = script.dataset;
  if (!data.embedKey) return null;

  const options: Record<string, string> = {
    // An empty `data-api-base` is meaningful: it means "same origin as this page".
    apiBaseUrl: data.apiBase ?? '',
    embedKey: data.embedKey,
  };

  if (data.lang) options.language = data.lang;
  if (data.mode) options.mode = data.mode;
  if (data.position) options.position = data.position;

  return options;
}

/**
 * Finds the script tag that carries the configuration.
 *
 * `document.currentScript` is the reliable answer for the built classic script. It is null
 * for ES modules, which is how `pnpm dev:widget` loads the entry, so fall back to a search.
 */
export function findConfigScript(): HTMLScriptElement | null {
  const current = document.currentScript;

  if (current instanceof HTMLScriptElement && current.dataset.embedKey) {
    return current;
  }

  return document.querySelector<HTMLScriptElement>('script[data-embed-key]');
}
