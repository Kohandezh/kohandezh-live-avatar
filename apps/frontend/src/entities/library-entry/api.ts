import { z } from 'zod';
import { apiClient, type PaginationParams } from '@/shared/api';
import {
  adminLibraryEntryPageSchema,
  adminLibraryEntrySchema,
  libraryRecordingPageSchema,
  librarySuggestionListSchema,
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
