import { expect, test, type Locator } from '@playwright/test';
import {
  FIRST_QUESTION,
  SECOND_QUESTION,
  expectLeadCardReachable,
  expectRecordedAnswerPlaying,
  fa,
  leadCard,
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

  test('an answer that plays to its end shows the lead card with focus on its heading; "Other questions" returns to the question (REQ-061)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: SECOND_QUESTION }).click();
    await expectRecordedAnswerPlaying(page);

    // The fixture is about 4 seconds long; its `ended` event finishes the answer.
    await expect(
      leadCard(page).getByRole('heading', { name: fa.library.lead.title }),
    ).toBeFocused({ timeout: 10_000 });
    await expect(recordedVideo(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: fa.assistant.start })).toHaveCount(0);

    await leadCard(page).getByRole('button', { name: fa.library.lead.backToQuestions }).click();

    await expect(
      suggestionList(page).getByRole('button', { name: SECOND_QUESTION }),
    ).toBeFocused();
    await expect(page.getByRole('button', { name: fa.assistant.start })).toBeVisible();
  });

  test('a follow-up plays like a suggestion, and after it the card has no follow-ups (REQ-077)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expect(page.getByText(fa.library.recordedLabel)).toBeVisible();
    await page.getByRole('button', { name: fa.library.stop }).click();
    const followUps = leadCard(page).getByRole('list', { name: fa.library.lead.followUpsTitle });

    await followUps.getByRole('button', { name: SECOND_QUESTION }).click();

    await expectRecordedAnswerPlaying(page);
    await expect(leadCard(page)).toHaveCount(0);
    await page.getByRole('button', { name: fa.library.stop }).click();
    await expect(leadCard(page).getByRole('heading', { name: fa.library.lead.title })).toBeFocused();
    // The sizing answer is stage 2 and the mock has no stage 3 answer: no heading, no list.
    await expect(
      leadCard(page).getByRole('button', { name: fa.library.lead.backToQuestions }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: fa.library.lead.followUpsTitle })).toHaveCount(0);
  });

  test('when the follow-ups cannot load, the lead card still works, with none and no error (section 8)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expect(page.getByText(fa.library.recordedLabel)).toBeVisible();
    // Withdrawn while it plays, so its follow-ups answer 404.
    await patchAsAdmin(page, '/api/admin/library/entries/mock-library-identity/status', {
      status: 'withdrawn',
    });

    await page.getByRole('button', { name: fa.library.stop }).click();

    await expect(leadCard(page).getByRole('link')).toHaveCount(6);
    await expect(leadCard(page).getByRole('button', { name: fa.library.lead.consult })).toBeEnabled();
    await expect(page.getByRole('heading', { name: fa.library.lead.followUpsTitle })).toHaveCount(0);
    await expect(page.getByRole('button', { name: fa.states.retry })).toHaveCount(0);
  });

  test('a failed start from the lead card shows the existing error and the contact card under it (REQ-078)', async ({ page }) => {
    // The provider cannot be reached, as while LiveAvatar is inactive.
    await page.route('https://api.liveavatar.com/**', (route) => route.abort());
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expect(page.getByText(fa.library.recordedLabel)).toBeVisible();
    await page.getByRole('button', { name: fa.library.stop }).click();

    await leadCard(page).getByRole('button', { name: fa.library.lead.consult }).click();

    await expect(page.getByText(fa.assistant.errors.title)).toBeVisible({ timeout: 15_000 });
    await expect(leadCard(page).getByText(fa.library.lead.liveUnavailable)).toBeVisible();
    await expect(leadCard(page).getByRole('link')).toHaveCount(6);
    await expect(leadCard(page).getByRole('button')).toHaveCount(0);
  });

  test('a failed plain Start shows the existing error alone (REQ-078)', async ({ page }) => {
    await page.route('https://api.liveavatar.com/**', (route) => route.abort());
    await expect(suggestionList(page)).toBeVisible();

    await page.getByRole('button', { name: fa.assistant.start }).click();

    await expect(page.getByText(fa.assistant.errors.title)).toBeVisible({ timeout: 15_000 });
    await expect(leadCard(page)).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
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

/** The `justify-content` of the `/video` middle column that holds `element` (ruling 12). */
function middleColumnJustify(element: Locator): Promise<string> {
  return element.evaluate((node) => {
    let current: HTMLElement | null = node.parentElement;
    // The column is the `flex-1` one; the error state inside it centres its own content too.
    while (
      current &&
      !(/\bflex-1\b/.test(current.className) && /\bjustify-(?:center|start)\b/.test(current.className))
    ) {
      current = current.parentElement;
    }
    return current ? getComputedStyle(current).justifyContent : 'none';
  });
}

/** Ruling 6, at the phone size the Foreman named, in both forms of the card and on both pages. */
test.describe('on a 390 x 844 phone the whole lead card can be reached (ruling 6)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ['/video', '/audio'] as const) {
    test(`${route}: after an answer`, async ({ page }) => {
      await loginToVideo(page);
      if (route === '/audio') {
        await page.getByRole('button', { name: fa.nav.audio }).click();
        await page.waitForURL('**/audio');
      }
      await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
      await page.getByRole('button', { name: fa.library.stop }).click();
      await expect(
        leadCard(page).getByRole('list', { name: fa.library.lead.followUpsTitle }),
      ).toBeVisible();

      await expectLeadCardReachable(page);
    });

    test(`${route}: under a failed consultation start`, async ({ page }) => {
      await page.route('https://api.liveavatar.com/**', (r) => r.abort());
      await loginToVideo(page);
      if (route === '/audio') {
        await page.getByRole('button', { name: fa.nav.audio }).click();
        await page.waitForURL('**/audio');
      }
      await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
      await page.getByRole('button', { name: fa.library.stop }).click();
      await leadCard(page).getByRole('button', { name: fa.library.lead.consult }).click();
      await expect(leadCard(page).getByText(fa.library.lead.liveUnavailable)).toBeVisible({
        timeout: 15_000,
      });

      await expectLeadCardReachable(page);
    });
  }

  test('/video centres the connecting line with plain `center`, not `safe center` (ruling 12)', async ({ page }) => {
    // The provider never answers, so the session stays in "connecting".
    await page.route('https://api.liveavatar.com/**', () => {});
    await loginToVideo(page);

    await page.getByRole('button', { name: fa.assistant.start }).click();

    const line = page.getByText(fa.assistant.status.connecting, { exact: true });
    await expect(line).toBeVisible();
    expect(await middleColumnJustify(line)).toBe('center');
  });

  test('/video starts at the top only under the lead card fallback (ruling 12)', async ({ page }) => {
    await page.route('https://api.liveavatar.com/**', (r) => r.abort());
    await loginToVideo(page);
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await page.getByRole('button', { name: fa.library.stop }).click();

    await leadCard(page).getByRole('button', { name: fa.library.lead.consult }).click();

    await expect(leadCard(page).getByText(fa.library.lead.liveUnavailable)).toBeVisible({
      timeout: 15_000,
    });
    const title = page.getByText(fa.assistant.errors.title, { exact: true });
    expect(await middleColumnJustify(title)).toBe('flex-start');
  });

  test('the contact values use the app\'s link style: underlined, accent on hover (rulings 7, 11)', async ({ page }) => {
    await loginToVideo(page);
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await page.getByRole('button', { name: fa.library.stop }).click();
    const links = leadCard(page).getByRole('link');
    await expect(links).toHaveCount(6);

    for (const link of await links.all()) {
      await expect(link.locator('[dir="ltr"]')).toHaveCSS('text-decoration-line', 'underline');
    }

    const value = links.first().locator('[dir="ltr"]');
    const resting = await value.evaluate((element) => getComputedStyle(element).color);
    const accent = await value.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      element.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(resting).not.toBe(accent);
    await links.first().hover();
    await expect(value).toHaveCSS('color', accent);
  });
});
