import { describe, expect, it } from 'vitest';
import enCommon from '@/i18n/locales/en/common.json';
import faCommon from '@/i18n/locales/fa/common.json';

/** Every leaf under `node` as a dotted path, with its value. */
function leaves(node: unknown, prefix: string): [string, unknown][] {
  if (node === null || typeof node !== 'object') return [[prefix, node]];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, `${prefix}.${key}`),
  );
}

/**
 * The user screen keys of spec section 8 that the playback step renders, with their wording. The
 * lead card keys (`library.lead.*`) arrive with the lead card, step 9.
 */
const PLAYBACK_KEYS: Record<string, { en: string; fa: string }> = {
  'library.suggestionsTitle': {
    en: 'Suggested questions',
    fa: 'پرسش‌های پیشنهادی',
  },
  'library.recordedLabel': { en: 'Recorded answer', fa: 'پاسخ ضبط‌شده' },
  'library.loading': {
    en: 'Loading the recorded answer',
    fa: 'در حال بارگیری پاسخ ضبط‌شده',
  },
  'library.stop': { en: 'Stop', fa: 'توقف' },
  'library.tapToPlay': {
    en: 'Tap to play the answer',
    fa: 'برای پخش پاسخ ضربه بزنید',
  },
  'library.captionLabel': { en: 'Answer text', fa: 'متن پاسخ' },
  'library.suggestionsError': {
    en: 'Suggested questions could not load.',
    fa: 'پرسش‌های پیشنهادی بارگیری نشد.',
  },
  'library.errors.notFound': {
    en: 'This answer is no longer available.',
    fa: 'این پاسخ دیگر در دسترس نیست.',
  },
  'library.errors.rateLimited': {
    en: 'You have played many answers. Try again in a few minutes.',
    fa: 'پاسخ‌های زیادی پخش کرده‌اید. چند دقیقه دیگر دوباره امتحان کنید.',
  },
  'library.errors.offline': {
    en: 'You are offline. Connect to play the answer.',
    fa: 'اتصال اینترنت برقرار نیست. برای پخش پاسخ متصل شوید.',
  },
  'library.errors.generic': {
    en: 'The recorded answer could not play. Try again, or start a live conversation.',
    fa: 'پاسخ ضبط‌شده پخش نشد. دوباره امتحان کنید یا گفت‌وگوی زنده را شروع کنید.',
  },
};

describe('library keys in common.json (section 8, SC-022)', () => {
  const english = new Map(leaves(enCommon.library, 'library'));
  const persian = new Map(leaves(faCommon.library, 'library'));

  it('has every library key in both languages, and nothing in one language only', () => {
    expect([...english.keys()].sort()).toEqual([...persian.keys()].sort());
  });

  it('has no empty value in either language', () => {
    for (const [key, value] of [...english, ...persian]) {
      expect(typeof value, key).toBe('string');
      expect((value as string).trim(), key).not.toBe('');
    }
  });

  it.each(Object.entries(PLAYBACK_KEYS))(
    '%s uses the wording of section 8',
    (key, wording) => {
      expect(english.get(key)).toBe(wording.en);
      expect(persian.get(key)).toBe(wording.fa);
    },
  );
});
