import { expect, test } from '@playwright/test';
import {
  FIRST_QUESTION,
  SECOND_QUESTION,
  expectRecordedAnswerPlaying,
  fa,
  loginToVideo,
  patchAsAdmin,
  recordedVideo,
  suggestionList,
} from './utils/answerLibrary';

/**
 * Recorded answers on the web app (spec docs/features/response-caching/SPEC.md, REQ-050 to
 * REQ-064). The mock serves a small real MP4 (about 4 seconds), so an answer can play to its end.
 * The mock library is Persian only, like the rendered library, so the flows run in Persian.
 */

/** 268 characters, under the 300 the backend allows for a question. */
const LONG_QUESTION =
  'در نخستین جلسه مشاوره چه اتفاقی می‌افتد، کل روند کاشت مو از اولین مراجعه تا نتیجه نهایی ' +
  'چقدر طول می‌کشد، و پیش از روز عمل چه آمادگی‌هایی لازم است تا دوره بهبودی برای من و خانواده‌ام ' +
  'در خانه تا جای ممکن سریع و راحت باشد و بدانم پس از عمل چه مراقبت‌هایی باید انجام بدهم؟';

test('a long question is clamped to two lines and keeps its whole text as its name (section 10)', async ({ page }) => {
  // On the login page, before the first list request, so the app only ever sees the long text.
  await page.goto('/login');
  const base = '/api/admin/library/entries/mock-library-identity';
  await patchAsAdmin(page, `${base}/status`, { status: 'draft' });
  await patchAsAdmin(page, base, { question: LONG_QUESTION });
  await patchAsAdmin(page, `${base}/status`, { status: 'published' });
  await loginToVideo(page, { onLoginPage: true });

  const question = suggestionList(page).getByRole('button', { name: LONG_QUESTION });
  await expect(question).toBeVisible();
  const text = question.locator('span.line-clamp-2');
  const lines = await text.evaluate((element) => {
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });
  expect(lines).toBe(2);
});

test.describe('after login', () => {
  test.beforeEach(async ({ page }) => {
    await loginToVideo(page);
  });

  test('an answer that plays to its end brings the list back with focus on it (REQ-061)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: SECOND_QUESTION }).click();
    await expectRecordedAnswerPlaying(page);

    // The fixture is about 4 seconds long; its `ended` event finishes the answer.
    await expect(
      suggestionList(page).getByRole('button', { name: SECOND_QUESTION }),
    ).toBeFocused({ timeout: 10_000 });
    await expect(recordedVideo(page)).toHaveCount(0);
  });

  test('an answer withdrawn after the list loaded says so and leaves the list, with no Retry (REQ-062)', async ({ page }) => {
    await expect(suggestionList(page).getByRole('button')).toHaveCount(2);
    await patchAsAdmin(page, '/api/admin/library/entries/mock-library-identity/status', {
      status: 'withdrawn',
    });

    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();

    await expect(page.getByText(fa.library.errors.notFound)).toBeVisible();
    await expect(suggestionList(page).getByRole('button', { name: FIRST_QUESTION })).toHaveCount(0);
    await expect(suggestionList(page).getByRole('button', { name: SECOND_QUESTION })).toBeVisible();
    await expect(page.getByRole('button', { name: fa.states.retry })).toHaveCount(0);
  });

  test('offline, the suggested questions cannot be pressed (section 10, offline)', async ({ page, context }) => {
    await expect(suggestionList(page).getByRole('button')).toHaveCount(2);

    await context.setOffline(true);

    for (const question of await suggestionList(page).getByRole('button').all()) {
      await expect(question).toBeDisabled();
    }

    await context.setOffline(false);
    await expect(suggestionList(page).getByRole('button').first()).toBeEnabled();
  });

  test('the caption never grows past about a third of the screen; more text scrolls (section 10)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    const caption = page.getByRole('region', { name: fa.library.captionLabel });
    await expect(caption).toBeVisible();

    // More text than fits, to prove the cap. Only the text node changes, to measure the layout.
    const size = await caption.evaluate((element) => {
      const text = element.querySelector('p');
      if (text) text.textContent = 'پاسخی بلند، واژه پس از واژه. '.repeat(40);
      return {
        height: element.getBoundingClientRect().height,
        limit: window.innerHeight / 3,
        scrolls: element.scrollHeight > element.clientHeight,
      };
    });

    expect(size.height).toBeLessThanOrEqual(size.limit + 1);
    expect(size.scrolls).toBe(true);
  });
});
