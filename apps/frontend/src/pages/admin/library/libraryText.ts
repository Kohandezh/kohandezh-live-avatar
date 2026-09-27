import {
  libraryLanguageSchema,
  librarySectionTypeSchema,
  libraryStatusSchema,
  libraryTechnicalSchema,
  type LibraryStatus,
} from '@/entities/library-entry';
import { isApiError } from '@/shared/api';

/** The rewrite rules of REQ-073, in the order the editor lists them. */
export const RULE_KEYS = [
  'spoken',
  'sentences',
  'length',
  'noNewFacts',
  'phoneWords',
  'bothNumbers',
] as const;

/** Above this the editor warns: allowed only when the answer has a phone number (REQ-073). */
export const SOFT_LIMIT = 350;
/** The server's hard limit (REQ-066). Above it Mark ready is disabled. */
export const HARD_LIMIT = 480;

export const STATUSES = libraryStatusSchema.options;
export const LANGUAGES = libraryLanguageSchema.options;
export const SECTION_TYPES = librarySectionTypeSchema.options;
export const TECHNICAL_VALUES = libraryTechnicalSchema.options;

/** The chip colour of each status in the list and the panel. */
export const STATUS_COLOR: Record<
  LibraryStatus,
  'default' | 'accent' | 'warning' | 'success' | 'danger'
> = {
  pending: 'default',
  ready: 'accent',
  draft: 'warning',
  published: 'success',
  withdrawn: 'danger',
};

/**
 * The text as the server stores it: trimmed, with every run of whitespace collapsed to one space
 * (REQ-003). Every length the editor shows is counted on this string (REQ-066).
 */
export function normalizeSpokenText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

const ERROR_KEYS: Record<string, string> = {
  invalid_status_transition: 'library.errors.statusChanged',
  library_video_not_ready: 'library.errors.videoNotReady',
  library_key_taken: 'library.errors.keyTaken',
  library_video_in_use: 'library.errors.videoInUse',
  library_text_mismatch: 'library.errors.textMismatch',
};

/** The `admin` i18n key of the message for a failed library write (section 8). */
export function libraryErrorKey(error: unknown): string {
  if (isApiError(error)) {
    const key = error.code ? ERROR_KEYS[error.code] : undefined;
    if (key) return key;
    if (error.isNetworkError) return 'library.errors.offline';
  }
  return 'library.errors.saveFailed';
}

/**
 * Page numbers to show around the current page. 'gap' marks a hidden range so the footer stays
 * short on long lists. The same rule as the users list (`AdminUsersPage`).
 */
export function getPageItems(
  page: number,
  pages: number,
): Array<number | 'gap'> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => index + 1);
  }

  const items: Array<number | 'gap'> = [1];
  if (page > 3) items.push('gap');
  for (
    let current = Math.max(2, page - 1);
    current <= Math.min(pages - 1, page + 1);
    current += 1
  ) {
    items.push(current);
  }
  if (page < pages - 2) items.push('gap');
  items.push(pages);

  return items;
}
