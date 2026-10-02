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
  // The hint while Record waits for the audio (REQ-036: its length must be known).
  'library.record.needsAudio': {
    en: 'Generate the audio first, so its length can be checked.',
    fa: 'اول صدا را بسازید تا طول آن بررسی شود.',
  },
  // Why Attach is off for another answer's recording.
  'library.record.otherAnswer': {
    en: 'This recording is of another answer. You can find it in the list below.',
    fa: 'این ضبط برای پاسخ دیگری است. آن را در فهرست پایین می‌بینید.',
  },
  // The admin recording flow table of section 8 (REQ-039 to REQ-042, REQ-074).
  'library.record.needsAccounts': {
    en: 'Recording needs an active LiveAvatar account and a paid ElevenLabs plan.',
    fa: 'ضبط به حساب فعال LiveAvatar و اشتراک پرداخت‌شده ElevenLabs نیاز دارد.',
  },
  'library.record.errors.sessionFailed': {
    en: 'The avatar session could not start. Check that the LiveAvatar account is active, then try again.',
    fa: 'جلسه آواتار شروع نشد. بررسی کنید که حساب LiveAvatar فعال باشد و دوباره امتحان کنید.',
  },
  'library.record.errors.speechPayment': {
    en: 'ElevenLabs refused the speech because the plan is not paid. Pay the ElevenLabs plan, then try again.',
    fa: 'ElevenLabs صدا را نساخت چون هزینه اشتراک پرداخت نشده است. اشتراک ElevenLabs را پرداخت کنید و دوباره امتحان کنید.',
  },
  'library.record.errors.speechBusy': {
    en: 'ElevenLabs is busy or its quota is used up. Wait a minute, then try again.',
    fa: 'ElevenLabs مشغول است یا سهمیه آن تمام شده است. یک دقیقه صبر کنید و دوباره امتحان کنید.',
  },
  'library.record.errors.speechFailed': {
    en: 'The avatar could not speak the answer. Check that the ElevenLabs plan is paid and active, then try again.',
    fa: 'آواتار نتوانست پاسخ را بگوید. بررسی کنید که اشتراک ElevenLabs پرداخت‌شده و فعال باشد و دوباره امتحان کنید.',
  },
  'library.record.errors.recordingUnavailable': {
    en: 'Recording is not available on this server. It needs the BYO transport and a public LiveKit address.',
    fa: 'ضبط روی این سرور در دسترس نیست. به حالت BYO و یک نشانی عمومی LiveKit نیاز دارد.',
  },
  'library.record.errors.recordingDuplicate': {
    en: 'This recording has already started. Stop it, or start a new avatar session.',
    fa: 'این ضبط قبلاً شروع شده است. آن را متوقف کنید یا جلسه آواتار تازه‌ای شروع کنید.',
  },
  'library.record.errors.recordingFailed': {
    en: 'The recording could not start. Try again.',
    fa: 'ضبط شروع نشد. دوباره امتحان کنید.',
  },
  'library.record.errors.finalizeFileMissing': {
    en: 'The video file did not appear in time. Record the answer again.',
    fa: 'فایل ویدیو به‌موقع آماده نشد. پاسخ را دوباره ضبط کنید.',
  },
  'library.record.errors.finalizeInvalid': {
    en: 'The video file is damaged or has no sound. Record the answer again.',
    fa: 'فایل ویدیو خراب است یا صدا ندارد. پاسخ را دوباره ضبط کنید.',
  },
  'library.record.errors.finalizeLost': {
    en: 'The server restarted while it processed the recording. Record the answer again.',
    fa: 'سرور هنگام پردازش ضبط دوباره راه‌اندازی شد. پاسخ را دوباره ضبط کنید.',
  },
  'library.record.errors.finalizeFailed': {
    en: 'Processing the recording failed. Record the answer again.',
    fa: 'پردازش ضبط ناموفق بود. پاسخ را دوباره ضبط کنید.',
  },
  'library.record.job.queued': {
    en: 'Waiting to process the recording',
    fa: 'در انتظار پردازش ضبط',
  },
  'library.record.job.running': {
    en: 'Processing the recording',
    fa: 'در حال پردازش ضبط',
  },
  'library.record.job.done': {
    en: 'The recording is ready. Save it to the library.',
    fa: 'ضبط آماده است. آن را در کتابخانه ذخیره کنید.',
  },
  'library.record.job.slow': {
    en: 'The recording is still being processed. Check again in a minute.',
    fa: 'ضبط هنوز در حال پردازش است. یک دقیقه دیگر دوباره بررسی کنید.',
  },
  'library.record.job.checkAgain': {
    en: 'Check again',
    fa: 'بررسی دوباره',
  },
  'library.record.unsaved': {
    en: 'Finished recordings not in the library',
    fa: 'ضبط‌های آماده‌ای که در کتابخانه نیستند',
  },
  'library.record.attach': {
    en: 'Attach to this answer',
    fa: 'افزودن به این پاسخ',
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
