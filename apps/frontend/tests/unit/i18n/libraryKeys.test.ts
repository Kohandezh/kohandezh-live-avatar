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
 * The user screen keys of spec section 8, with their wording: the playback keys and the lead card
 * keys (`library.lead.*`, step 9).
 */
const SECTION_8_KEYS: Record<string, { en: string; fa: string }> = {
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
  'library.lead.title': {
    en: 'What would you like to do next?',
    fa: 'قدم بعدی شما چیست؟',
  },
  'library.lead.consult': {
    en: 'Request a consultation',
    fa: 'درخواست مشاوره',
  },
  'library.lead.consultHint': {
    en: 'Talk to our live assistant. It asks a few questions about your needs.',
    fa: 'با دستیار زنده ما گفت‌وگو کنید. چند سؤال درباره نیاز شما می‌پرسد.',
  },
  'library.lead.liveUnavailable': {
    en: 'The live assistant is not available right now. Please use the contact details below.',
    fa: 'دستیار زنده در حال حاضر در دسترس نیست. لطفاً از راه‌های تماس زیر استفاده کنید.',
  },
  'library.lead.contactTitle': { en: 'Contact us', fa: 'تماس با ما' },
  'library.lead.office': { en: 'Office', fa: 'دفتر' },
  'library.lead.sales': { en: 'Sales', fa: 'فروش' },
  'library.lead.email': { en: 'Email', fa: 'ایمیل' },
  'library.lead.website': { en: 'Website', fa: 'وب‌سایت' },
  'library.lead.callLabel': {
    en: 'Call {{label}}: {{number}}',
    fa: 'تماس با {{label}}: {{number}}',
  },
  'library.lead.followUpsTitle': { en: 'Related questions', fa: 'پرسش‌های مرتبط' },
  'library.lead.backToQuestions': { en: 'Other questions', fa: 'پرسش‌های دیگر' },
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

  it.each(Object.entries(SECTION_8_KEYS))(
    '%s uses the wording of section 8',
    (key, wording) => {
      expect(english.get(key)).toBe(wording.en);
      expect(persian.get(key)).toBe(wording.fa);
    },
  );
});
