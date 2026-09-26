import { describe, expect, it } from 'vitest';
import {
  adminLibraryEntryPageSchema,
  adminLibraryEntrySchema,
  libraryRecordingSchema,
  librarySuggestionListSchema,
  librarySuggestionSchema,
} from '@/entities/library-entry';

const suggestion = {
  id: '8f14e45f-ceea-467f-a0e6-4b0b9b6c9d9a',
  question: 'برای کاشت مو چند گرافت لازم دارم؟',
  answerText: 'تعداد گرافت به وسعت ناحیه بستگی دارد.',
  durationMs: 42_000,
};

const pendingEntry = {
  id: 'e-1',
  key: 'C18Q05',
  question: 'پرسش',
  answerText: null,
  answerOriginal: 'پاسخ اصلی',
  language: 'fa',
  category: '18',
  categoryTitle: 'کاشت مو',
  sectionType: 'knowledge',
  technical: 'classify',
  status: 'pending',
  position: 3,
  videoAssetId: null,
  videoStatus: null,
  durationMs: null,
  createdAt: '2026-09-26T08:00:00Z',
  publishedAt: null,
  withdrawnAt: null,
};

describe('librarySuggestionSchema', () => {
  it('accepts exactly the four public fields', () => {
    expect(librarySuggestionSchema.parse(suggestion)).toEqual(suggestion);
  });

  it.each([
    ['videoAssetId', 'v-1'],
    ['key', 'C18Q05'],
    ['category', '18'],
    ['sectionType', 'sizing'],
    ['technical', 'technical'],
    ['answerOriginal', 'متن اصلی'],
  ])('rejects a response that also carries %s', (field, value) => {
    expect(
      librarySuggestionSchema.safeParse({ ...suggestion, [field]: value })
        .success,
    ).toBe(false);
  });

  it('rejects a missing field or an empty question', () => {
    const withoutDuration: Record<string, unknown> = { ...suggestion };
    delete withoutDuration['durationMs'];

    expect(librarySuggestionSchema.safeParse(withoutDuration).success).toBe(
      false,
    );
    expect(
      librarySuggestionSchema.safeParse({ ...suggestion, question: '' })
        .success,
    ).toBe(false);
  });

  it('accepts an empty list, which is normal', () => {
    expect(librarySuggestionListSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });
});

describe('adminLibraryEntrySchema', () => {
  it('accepts a pending entry with no answer text and no video', () => {
    expect(adminLibraryEntrySchema.parse(pendingEntry)).toEqual(pendingEntry);
  });

  it('accepts a published entry with its video', () => {
    const published = {
      ...pendingEntry,
      answerText: 'پاسخ گفتاری',
      status: 'published',
      videoAssetId: 'v-1',
      videoStatus: 'VIDEO_APPROVED',
      durationMs: 42_000,
      publishedAt: '2026-09-26T09:00:00Z',
    };

    expect(adminLibraryEntrySchema.parse(published)).toEqual(published);
  });

  it.each([
    ['status', 'archived'],
    ['sectionType', 'sales'],
    ['technical', 'maybe'],
    ['language', 'de'],
    ['answerText', ''],
  ])('rejects %s = %s', (field, value) => {
    expect(
      adminLibraryEntrySchema.safeParse({ ...pendingEntry, [field]: value })
        .success,
    ).toBe(false);
  });

  it('parses a page of entries', () => {
    const page = { items: [pendingEntry], total: 1, page: 1, pageSize: 10 };

    expect(adminLibraryEntryPageSchema.parse(page)).toEqual(page);
  });
});

describe('libraryRecordingSchema', () => {
  it('accepts a finished recording and rejects one without its text', () => {
    const recording = {
      videoAssetId: 'v-2',
      answerText: 'متن ضبط',
      durationMs: 5200,
      createdAt: '2026-09-26T08:00:00Z',
    };

    expect(libraryRecordingSchema.parse(recording)).toEqual(recording);
    expect(
      libraryRecordingSchema.safeParse({ ...recording, answerText: '' })
        .success,
    ).toBe(false);
  });
});
