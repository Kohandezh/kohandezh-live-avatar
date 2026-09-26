import { describe, expect, it } from 'vitest';
import enAdmin from '@/i18n/locales/en/admin.json';
import faAdmin from '@/i18n/locales/fa/admin.json';

/**
 * The admin wording of the answer library, copied from the table "Admin screens (`admin.json`)" in
 * section 8 of docs/features/response-caching/SPEC.md. The spec is the contract for these strings,
 * in both languages.
 */
const SPEC_WORDING: Record<string, { en: string; fa: string }> = {
  'library.noMatch': {
    en: 'No answers match these filters.',
    fa: 'هیچ پاسخی با این فیلترها پیدا نشد.',
  },
  'library.unsavedText': {
    en: 'Your unsaved text',
    fa: 'متن ذخیره‌نشده شما',
  },
  'nav.library': {
    en: 'Answer library',
    fa: 'کتابخانه پاسخ‌ها',
  },
  'library.status.pending': {
    en: 'Waiting for text approval',
    fa: 'در انتظار تأیید متن',
  },
  'library.status.ready': {
    en: 'Ready for video',
    fa: 'آماده ساخت ویدیو',
  },
  'library.status.draft': {
    en: 'Waiting for video review',
    fa: 'در انتظار بررسی ویدیو',
  },
  'library.status.published': {
    en: 'Published',
    fa: 'منتشرشده',
  },
  'library.status.withdrawn': {
    en: 'Withdrawn',
    fa: 'حذف‌شده',
  },
  'library.readyHint': {
    en: 'Record this answer here, or export it for a render run on the render server. Both need an active LiveAvatar account.',
    fa: 'این پاسخ را همین‌جا ضبط کنید، یا آن را برای ساخت روی سرور ساخت ویدیو خروجی بگیرید. هر دو به حساب فعال LiveAvatar نیاز دارند.',
  },
  'library.empty': {
    en: 'No answers yet. Record one, or import the answer files on the server.',
    fa: 'هنوز پاسخی وجود ندارد. یک پاسخ ضبط کنید یا فایل‌های پاسخ را روی سرور وارد کنید.',
  },
  'library.withdrawConfirm': {
    en: 'Withdraw this answer? Users stop seeing it now. Its video is deleted at the next daily cleanup and cannot be restored.',
    fa: 'این پاسخ حذف شود؟ کاربران از همین حالا آن را نمی‌بینند. ویدیوی آن در پاک‌سازی روزانه بعدی حذف می‌شود و قابل بازگرداندن نیست.',
  },
  'library.rejectConfirm': {
    en: 'Reject this video? It is deleted at the next daily cleanup. The answer goes back to Ready for video, and a new recording costs paid minutes.',
    fa: 'این ویدیو رد شود؟ در پاک‌سازی روزانه بعدی حذف می‌شود. پاسخ به «آماده ساخت ویدیو» برمی‌گردد و ضبط دوباره هزینه دارد.',
  },
  'library.errors.statusChanged': {
    en: 'This answer changed in the meantime. The page now shows its current state.',
    fa: 'این پاسخ در این فاصله تغییر کرده است. صفحه اکنون وضعیت فعلی آن را نشان می‌دهد.',
  },
  'library.errors.videoNotReady': {
    en: 'The video is not ready. Wait until the recording has finished.',
    fa: 'ویدیو آماده نیست. صبر کنید تا ضبط تمام شود.',
  },
  'library.errors.keyTaken': {
    en: 'This key is already used by another answer.',
    fa: 'این کلید برای پاسخ دیگری استفاده شده است.',
  },
  'library.errors.videoInUse': {
    en: 'This video already belongs to another answer.',
    fa: 'این ویدیو به پاسخ دیگری تعلق دارد.',
  },
  'library.errors.textMismatch': {
    en: 'This video does not say the approved text of this answer.',
    fa: 'این ویدیو متن تأییدشده این پاسخ را نمی‌گوید.',
  },
  'library.errors.tooLong': {
    en: 'This answer is too long for one recording. Keep its audio under 4 minutes 30 seconds.',
    fa: 'این پاسخ برای یک ضبط طولانی است. صدای آن باید کمتر از ۴ دقیقه و ۳۰ ثانیه باشد.',
  },
  'library.rules.title': {
    en: 'How to write the spoken answer',
    fa: 'راهنمای نوشتن پاسخ گفتاری',
  },
  'library.rules.spoken': {
    en: 'Write in spoken Persian, as the practitioner would say it aloud.',
    fa: 'به فارسی گفتاری بنویسید، همان‌طور که کارشناس آن را بلند می‌گوید.',
  },
  'library.rules.sentences': {
    en: 'Two to four sentences, then one bridge sentence that leads to the next step.',
    fa: 'دو تا چهار جمله، و در پایان یک جمله پل که به قدم بعدی می‌رسد.',
  },
  'library.rules.length': {
    en: 'At most 350 characters, or 480 when the answer has a phone number.',
    fa: 'حداکثر ۳۵۰ نویسه، یا ۴۸۰ نویسه اگر پاسخ شماره تلفن دارد.',
  },
  'library.rules.noNewFacts': {
    en: 'No new facts. Use only what the original answer says.',
    fa: 'هیچ واقعیت تازه‌ای اضافه نکنید. فقط از گفته‌های پاسخ اصلی استفاده کنید.',
  },
  'library.rules.phoneWords': {
    en: 'Write phone numbers as Persian words, in groups.',
    fa: 'شماره تلفن‌ها را با حروف فارسی و گروه‌گروه بنویسید.',
  },
  'library.rules.bothNumbers': {
    en: 'When a line has two numbers, give both.',
    fa: 'اگر یک خط دو شماره دارد، هر دو را بگویید.',
  },
  'library.rules.counter': {
    en: '{{count}} characters',
    fa: '{{count}} نویسه',
  },
  'library.rules.overSoft': {
    en: 'Longer than 350 characters. This is allowed only when the answer has a phone number.',
    fa: 'بیش از ۳۵۰ نویسه است. این فقط وقتی مجاز است که پاسخ شماره تلفن داشته باشد.',
  },
  'library.rules.overHard': {
    en: 'Longer than 480 characters. Shorten it before marking it ready.',
    fa: 'بیش از ۴۸۰ نویسه است. پیش از تأیید آن را کوتاه کنید.',
  },
};

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Tree)[part] : undefined,
      tree,
    );
}

/** Every leaf key under `node`, as dotted paths. */
function leafKeys(node: unknown, prefix: string): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, `${prefix}.${key}`),
  );
}

describe('answer library admin keys (SC-022)', () => {
  it.each(Object.entries(SPEC_WORDING))(
    '%s has the spec wording in en and fa',
    (key, wording) => {
      expect(lookup(enAdmin as Tree, key)).toBe(wording.en);
      expect(lookup(faAdmin as Tree, key)).toBe(wording.fa);
    },
  );

  it('has every library key in both languages, and none empty', () => {
    const en = leafKeys((enAdmin as Tree).library, 'library').sort();
    const fa = leafKeys((faAdmin as Tree).library, 'library').sort();

    expect(fa).toEqual(en);
    for (const key of en) {
      expect(lookup(enAdmin as Tree, key)).toEqual(expect.any(String));
      expect(lookup(enAdmin as Tree, key)).not.toBe('');
      expect(lookup(faAdmin as Tree, key)).not.toBe('');
    }
  });
});
