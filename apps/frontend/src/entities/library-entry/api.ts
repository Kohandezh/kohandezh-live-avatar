import { z } from 'zod';
import { ApiError, apiClient, type PaginationParams } from '@/shared/api';
import {
  adminLibraryEntryPageSchema,
  adminLibraryEntrySchema,
  libraryRecordingPageSchema,
  librarySuggestionListSchema,
  type AdminLibraryEntry,
  type ChangeLibraryStatusInput,
  type CreateLibraryEntryInput,
  type LibraryEntryListParams,
  type LibraryLanguage,
  type UpdateLibraryEntryInput,
} from './types';

const blobSchema = z.instanceof(Blob);

function entryPath(id: string): string {
  return `/api/admin/library/entries/${encodeURIComponent(id)}`;
}

function answerPath(id: string): string {
  return `/api/library/answers/${encodeURIComponent(id)}`;
}

/** The recorded answers a signed-in user may play in `language`, stage 1 questions first. */
export async function getLibrarySuggestions(
  language: LibraryLanguage,
  limit?: number,
) {
  const { data } = await apiClient.get('/api/library/suggestions', {
    params: { language, limit },
  });
  return librarySuggestionListSchema.parse(data).items;
}

/**
 * The whole MP4 of a published entry, through the same client and credential as every request.
 * The blob is never put in the query cache, and no `<video src>` ever points at the API. A `404`
 * means the entry was withdrawn or unpublished; a `429` means too many plays in the last hour.
 */
export async function fetchLibraryVideo(id: string, signal?: AbortSignal) {
  const { data } = await apiClient.get<Blob>(`${answerPath(id)}/video`, {
    responseType: 'blob',
    headers: { Accept: 'video/mp4' },
    timeout: 60_000,
    signal,
  });
  return blobSchema.parse(data);
}

/** Up to three published answers one funnel stage further on. An empty list is normal. */
export async function getLibraryFollowUps(id: string) {
  const { data } = await apiClient.get(`${answerPath(id)}/follow-ups`);
  return librarySuggestionListSchema.parse(data).items;
}

/** Admin only. The backend enforces the admin role. */
export async function listLibraryEntries(params: LibraryEntryListParams = {}) {
  const { data } = await apiClient.get('/api/admin/library/entries', {
    params,
  });
  return adminLibraryEntryPageSchema.parse(data);
}

/**
 * Admin only. Every `ready` entry, read page by page: the Attach picker of the Record answer
 * screen (REQ-042) matches a recording's text against all of them.
 */
export async function listReadyLibraryEntries() {
  const entries: AdminLibraryEntry[] = [];
  for (let page = 1; ; page += 1) {
    const result = await listLibraryEntries({ status: 'ready', page, pageSize: 100 });
    entries.push(...result.items);
    if (result.items.length === 0 || entries.length >= result.total) return entries;
  }
}

/**
 * Admin only. One entry, read again through the list search on its key: the contract has no
 * single-entry route, and a key is unique. Answers `404 not_found` when the entry is gone.
 */
export async function getLibraryEntry({
  id,
  key,
}: {
  id: string;
  key: string;
}) {
  const page = await listLibraryEntries({ q: key, pageSize: 100 });
  const entry = page.items.find((item) => item.id === id);
  if (!entry) {
    throw new ApiError({
      message: 'library answer was not found',
      status: 404,
      code: 'not_found',
      serverCode: 'not_found',
      category: 'NOT_FOUND',
    });
  }
  return entry;
}

/**
 * Admin only. The MP4 of an entry under review (`GET /api/assets/video/{id}`), through the same
 * client and credential, so no `<video src>` points at the API. The blob is not put in the query
 * cache.
 */
export async function fetchLibraryEntryVideo(
  videoAssetId: string,
  signal?: AbortSignal,
) {
  const { data } = await apiClient.get<Blob>(
    `/api/assets/video/${encodeURIComponent(videoAssetId)}`,
    {
      responseType: 'blob',
      headers: { Accept: 'video/mp4' },
      timeout: 60_000,
      signal,
    },
  );
  return blobSchema.parse(data);
}

/** Admin only. */
export async function createLibraryEntry(input: CreateLibraryEntryInput) {
  const { data } = await apiClient.post('/api/admin/library/entries', input);
  return adminLibraryEntrySchema.parse(data);
}

/** Admin only. A `409 invalid_status_transition` means a field is locked in the current status. */
export async function updateLibraryEntry(
  id: string,
  input: UpdateLibraryEntryInput,
) {
  const { data } = await apiClient.patch(entryPath(id), input);
  return adminLibraryEntrySchema.parse(data);
}

/**
 * Admin only. Every status change goes through this one route; a `409 invalid_status_transition`
 * carries `currentStatus` when the entry moved meanwhile.
 */
export async function changeLibraryEntryStatus(
  id: string,
  input: ChangeLibraryStatusInput,
) {
  const { data } = await apiClient.patch(`${entryPath(id)}/status`, input);
  return adminLibraryEntrySchema.parse(data);
}

/** Admin only. Finished recordings that no entry uses yet, newest first. */
export async function listLibraryRecordings(
  params: Pick<PaginationParams, 'page' | 'pageSize'> = {},
) {
  const { data } = await apiClient.get('/api/admin/library/recordings', {
    params,
  });
  return libraryRecordingPageSchema.parse(data);
}
