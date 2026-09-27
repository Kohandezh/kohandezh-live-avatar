import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changeLibraryEntryStatus,
  fetchLibraryEntryVideo,
  fetchLibraryVideo,
  getLibraryEntry,
  getLibrarySuggestions,
} from '@/entities/library-entry';
import { apiClient } from '@/shared/api';

const entryReply = {
  id: 'e-1',
  key: 'C1Q1',
  question: 'پرسش',
  answerText: 'پاسخ',
  answerOriginal: null,
  language: 'fa',
  category: '1',
  categoryTitle: 'دسته',
  sectionType: 'identity',
  technical: 'non-technical',
  status: 'draft',
  position: 1,
  videoAssetId: 'v-1',
  videoStatus: 'VIDEO_GENERATED',
  durationMs: 1000,
  createdAt: '2026-09-26T08:00:00Z',
  publishedAt: null,
  withdrawnAt: null,
};

describe('library entry API', () => {
  const realAdapter = apiClient.defaults.adapter;
  let sent: InternalAxiosRequestConfig | undefined;
  let reply: unknown;

  beforeEach(() => {
    sent = undefined;
    reply = undefined;
    apiClient.defaults.adapter = async (config) => {
      sent = config;
      return {
        data: reply,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
  });

  afterEach(() => {
    apiClient.defaults.adapter = realAdapter;
  });

  it('downloads the whole video as a blob through the shared client', async () => {
    reply = new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' });
    const controller = new AbortController();

    const blob = await fetchLibraryVideo('entry/1', controller.signal);

    expect(blob).toBe(reply);
    expect(sent?.url).toBe('/api/library/answers/entry%2F1/video');
    expect(sent?.responseType).toBe('blob');
    // One answer can be several megabytes on a slow phone network.
    expect(sent?.timeout).toBe(60_000);
    expect(sent?.signal).toBe(controller.signal);
  });

  it('rejects a video answer that is not a blob', async () => {
    reply = { error: 'not a file' };

    await expect(fetchLibraryVideo('entry-1')).rejects.toThrow();
  });

  it('asks for the suggestions in one language and rejects extra fields', async () => {
    reply = {
      items: [
        {
          id: 'e-1',
          question: 'پرسش',
          answerText: 'پاسخ',
          durationMs: 1000,
          videoAssetId: 'v-1',
        },
      ],
    };

    await expect(getLibrarySuggestions('fa')).rejects.toThrow();
    expect(sent?.params).toEqual({ language: 'fa', limit: undefined });
  });

  it('downloads a video under review as a blob from the admin asset route (REQ-032)', async () => {
    reply = new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' });

    const blob = await fetchLibraryEntryVideo('video/1');

    expect(blob).toBe(reply);
    expect(sent?.url).toBe('/api/assets/video/video%2F1');
    expect(sent?.responseType).toBe('blob');
  });

  it('reads one entry back through the list search on its key', async () => {
    const other = { ...entryReply, id: 'e-2', key: 'C1Q10' };
    reply = { items: [other, entryReply], total: 2, page: 1, pageSize: 100 };

    const entry = await getLibraryEntry({ id: 'e-1', key: 'C1Q1' });

    expect(entry.id).toBe('e-1');
    expect(sent?.url).toBe('/api/admin/library/entries');
    expect(sent?.params).toEqual({ q: 'C1Q1', pageSize: 100 });
  });

  it('answers not_found when the search no longer holds the entry', async () => {
    reply = { items: [], total: 0, page: 1, pageSize: 100 };

    await expect(
      getLibraryEntry({ id: 'e-1', key: 'C1Q1' }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('needs the status the screen showed on every status change', () => {
    // Owner decision (2026-09-26): `fromStatus` is required in the type, so no caller can forget
    // it. `pnpm build` type-checks this file and fails if the field becomes optional again.
    // @ts-expect-error fromStatus is missing
    const call = () => changeLibraryEntryStatus('e-1', { status: 'ready' });
    expect(call).toBeTypeOf('function');
  });

  it('sends a status change to the one status route', async () => {
    reply = entryReply;

    const entry = await changeLibraryEntryStatus('e-1', {
      status: 'draft',
      videoAssetId: 'v-1',
      fromStatus: 'ready',
    });

    expect(entry.status).toBe('draft');
    expect(sent?.method).toBe('patch');
    expect(sent?.url).toBe('/api/admin/library/entries/e-1/status');
    expect(JSON.parse(String(sent?.data))).toEqual({
      status: 'draft',
      videoAssetId: 'v-1',
      fromStatus: 'ready',
    });
  });
});
