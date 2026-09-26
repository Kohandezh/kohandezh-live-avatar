import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changeLibraryEntryStatus,
  fetchLibraryVideo,
  getLibrarySuggestions,
} from '@/entities/library-entry';
import { apiClient } from '@/shared/api';

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

  it('sends a status change to the one status route', async () => {
    reply = {
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
