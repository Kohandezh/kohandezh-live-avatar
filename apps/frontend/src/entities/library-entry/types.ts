import { z } from 'zod';
import { paginatedSchema, type PaginationParams } from '@/shared/api';

export const libraryLanguageSchema = z.enum(['fa', 'en']);
export type LibraryLanguage = z.infer<typeof libraryLanguageSchema>;

/**
 * The owner's four working states, plus the final `withdrawn`. `pending` has text only, `ready`
 * waits for a video, `draft` waits for the video's review, `published` is what users see.
 */
export const libraryStatusSchema = z.enum([
  'pending',
  'ready',
  'draft',
  'published',
  'withdrawn',
]);
export type LibraryStatus = z.infer<typeof libraryStatusSchema>;

/** Gives the funnel stage of the follow-ups (see `docs/API.md`). */
export const librarySectionTypeSchema = z.enum([
  'knowledge',
  'identity',
  'sizing',
  'meeting',
  'commercial',
  'casual',
]);
export type LibrarySectionType = z.infer<typeof librarySectionTypeSchema>;

export const libraryTechnicalSchema = z.enum([
  'technical',
  'non-technical',
  'classify',
]);
export type LibraryTechnical = z.infer<typeof libraryTechnicalSchema>;

/**
 * One recorded answer a signed-in user may play (GET /api/library/suggestions and
 * GET /api/library/answers/{id}/follow-ups). Strict on purpose: the backend promises exactly these
 * four fields, so a video id, a key or a category arriving here is a contract break.
 */
export const librarySuggestionSchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  answerText: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
});
export type LibrarySuggestion = z.infer<typeof librarySuggestionSchema>;

export const librarySuggestionListSchema = z.object({
  items: z.array(librarySuggestionSchema),
});

/** An entry as the admin list shows it (admin only). */
export const adminLibraryEntrySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  question: z.string().min(1),
  /** The approved spoken text. Null in `pending` until an admin writes it. */
  answerText: z.string().min(1).nullable(),
  /** The original answer before the rewrite, for the admin only. */
  answerOriginal: z.string().nullable(),
  language: libraryLanguageSchema,
  category: z.string().min(1),
  categoryTitle: z.string(),
  sectionType: librarySectionTypeSchema,
  technical: libraryTechnicalSchema,
  status: libraryStatusSchema,
  position: z.number().int(),
  /** Null in `pending` and `ready`, and once the media of a withdrawn entry is deleted. */
  videoAssetId: z.string().min(1).nullable(),
  /** The `video_assets` status of that video, for example `VIDEO_GENERATED`. */
  videoStatus: z.string().min(1).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** ISO 8601 date-time strings. */
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
});
export type AdminLibraryEntry = z.infer<typeof adminLibraryEntrySchema>;

export const adminLibraryEntryPageSchema = paginatedSchema(
  adminLibraryEntrySchema,
);

/** A finished recording that no entry uses yet (admin only). */
export const libraryRecordingSchema = z.object({
  videoAssetId: z.string().min(1),
  answerText: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type LibraryRecording = z.infer<typeof libraryRecordingSchema>;

export const libraryRecordingPageSchema = paginatedSchema(
  libraryRecordingSchema,
);

export interface LibraryEntryListParams extends PaginationParams {
  status?: LibraryStatus;
  language?: LibraryLanguage;
  category?: string;
  sectionType?: LibrarySectionType;
  technical?: LibraryTechnical;
}

interface LibraryEntryLabels {
  question: string;
  language: LibraryLanguage;
  category: string;
  categoryTitle: string;
  sectionType: LibrarySectionType;
  technical: LibraryTechnical;
}

/**
 * POST /api/admin/library/entries. With text and no video it creates a `pending` entry and needs
 * a `key`. With `videoAssetId` it creates a `draft` entry from a finished recording, takes the
 * recording's text, and `key` defaults to the recording's name.
 */
export type CreateLibraryEntryInput = LibraryEntryLabels &
  (
    | {
        key: string;
        answerText?: string;
        answerOriginal?: string;
        videoAssetId?: never;
      }
    | {
        key?: string;
        answerOriginal?: string;
        videoAssetId: string;
        answerText?: never;
      }
  );

/**
 * PATCH /api/admin/library/entries/{id}: only the fields to change. `answerText` and `language`
 * change only in `pending`; nothing changes in `published` or `withdrawn`.
 */
export type UpdateLibraryEntryInput = Partial<LibraryEntryLabels> & {
  answerText?: string | null;
};

/** PATCH /api/admin/library/entries/{id}/status. `videoAssetId` attaches a video to a ready entry. */
export interface ChangeLibraryStatusInput {
  status: LibraryStatus;
  videoAssetId?: string;
  /**
   * The status the screen showed. Send it: a target such as `ready` means one thing from
   * `pending` (mark ready) and another from `draft` (reject the video), so the backend answers
   * `409 invalid_status_transition` instead of running the other one on a stale screen.
   */
  fromStatus?: LibraryStatus;
}
