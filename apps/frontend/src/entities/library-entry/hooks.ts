import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { PaginationParams } from '@/shared/api';
import {
  changeLibraryEntryStatus,
  createLibraryEntry,
  getLibraryEntry,
  getLibraryFollowUps,
  getLibrarySuggestions,
  listLibraryEntries,
  listLibraryRecordings,
  listReadyLibraryEntries,
  updateLibraryEntry,
} from './api';
import type {
  AdminLibraryEntry,
  ChangeLibraryStatusInput,
  LibraryEntryListParams,
  LibraryLanguage,
  UpdateLibraryEntryInput,
} from './types';

type RecordingParams = Pick<PaginationParams, 'page' | 'pageSize'>;

export const libraryEntryKeys = {
  all: ['library-entry'] as const,
  suggestions: (language: LibraryLanguage) =>
    [...libraryEntryKeys.all, 'suggestions', language] as const,
  followUps: (id: string) =>
    [...libraryEntryKeys.all, 'follow-ups', id] as const,
  list: (params: LibraryEntryListParams) =>
    [...libraryEntryKeys.all, 'list', params] as const,
  detail: (id: string) => [...libraryEntryKeys.all, 'detail', id] as const,
  ready: () => [...libraryEntryKeys.all, 'ready'] as const,
  recordings: (params: RecordingParams) =>
    [...libraryEntryKeys.all, 'recordings', params] as const,
};

/**
 * The suggested questions. The caller passes `enabled` false while a live conversation is not
 * idle, so no request runs then.
 */
export function useLibrarySuggestions(
  language: LibraryLanguage,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: libraryEntryKeys.suggestions(language),
    queryFn: () => getLibrarySuggestions(language),
    enabled,
  });
}

/** The follow-ups of a played answer. No request while `id` is null. */
export function useLibraryFollowUps(id: string | null) {
  return useQuery({
    queryKey: libraryEntryKeys.followUps(id ?? ''),
    queryFn: () => getLibraryFollowUps(id ?? ''),
    enabled: id !== null,
  });
}

export function useLibraryEntries(params: LibraryEntryListParams) {
  return useQuery({
    queryKey: libraryEntryKeys.list(params),
    queryFn: () => listLibraryEntries(params),
    // Keeps the old page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

/**
 * One entry, for the admin panel. Starts from the list row the admin opened, and refetches after
 * every library write, so a `409` shows the entry's current state.
 */
export function useLibraryEntry(row: AdminLibraryEntry) {
  return useQuery({
    queryKey: libraryEntryKeys.detail(row.id),
    queryFn: () => getLibraryEntry(row),
    initialData: row,
  });
}

/**
 * One entry found by its id and key, for a screen opened from a link (the Record answer screen of
 * REQ-074). Shares the panel's cache entry. No request while `ref` is null.
 */
export function useLibraryEntryByKey(ref: { id: string; key: string } | null) {
  return useQuery({
    queryKey: libraryEntryKeys.detail(ref?.id ?? ''),
    queryFn: () => getLibraryEntry(ref ?? { id: '', key: '' }),
    enabled: ref !== null,
  });
}

/** Every `ready` entry, for the Attach picker of the unsaved recordings (REQ-042). */
export function useReadyLibraryEntries() {
  return useQuery({
    queryKey: libraryEntryKeys.ready(),
    queryFn: listReadyLibraryEntries,
  });
}

export function useLibraryRecordings(params: RecordingParams) {
  return useQuery({
    queryKey: libraryEntryKeys.recordings(params),
    queryFn: () => listLibraryRecordings(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Every write can change what the admin list, the unsaved recordings and the users' suggestions
 * show, so each one refetches the whole library.
 */
function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: libraryEntryKeys.all });
}

/** Puts the entry the server answered into the panel at once, then refetches the library. */
function useStoreEntry() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLibrary();
  return (entry: AdminLibraryEntry) => {
    queryClient.setQueryData(libraryEntryKeys.detail(entry.id), entry);
    return invalidate();
  };
}

export function useCreateLibraryEntry() {
  const invalidate = useInvalidateLibrary();
  return useMutation({ mutationFn: createLibraryEntry, onSuccess: invalidate });
}

export function useUpdateLibraryEntry() {
  const storeEntry = useStoreEntry();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateLibraryEntryInput;
    }) => updateLibraryEntry(id, input),
    onSuccess: storeEntry,
  });
}

export function useChangeLibraryEntryStatus() {
  const storeEntry = useStoreEntry();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ChangeLibraryStatusInput;
    }) => changeLibraryEntryStatus(id, input),
    onSuccess: storeEntry,
  });
}
