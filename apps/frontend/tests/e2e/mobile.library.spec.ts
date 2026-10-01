import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  FIRST_ANSWER,
  FIRST_QUESTION,
  SECOND_QUESTION,
  allSources,
  expectLeadCardReachable,
  expectRecordedAnswerPlaying,
  fa,
  leadCard,
  loginToVideo,
  recordedVideo,
  suggestionList,
} from './utils/answerLibrary';

/**
 * Recorded answers on the mobile app (spec docs/features/response-caching/SPEC.md, REQ-050 to
 * REQ-064). The mock serves a small real MP4, so the player itself runs in the browser here. The
 * mock library is Persian only, like the rendered library, so the playback flows run in Persian.
 *
 * What only a browser can show, and so lives here rather than in Vitest: Start never moves, the
 * 44 px targets, the file actually playing, the orb breathing and the sound element never shown.
 */

/** The real SDK's own base URL. Never our mock. */
const LIVEAVATAR_API_GLOB = 'https://api.liveavatar.com/**';

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('not rendered');
  return bounds;
}

async function openAudio(page: Page, label: string) {
  await page.getByRole('button', { name: label }).click();
  await page.waitForURL('**/audio');
}

test.describe('playback', () => {
  test.beforeEach(async ({ page }) => {
    await loginToVideo(page);
  });

  test('Start does not move when the list arrives, while an answer loads, plays, or back from the lead card (REQ-056)', async ({ page }) => {
    const start = page.getByRole('button', { name: fa.assistant.start });
    const before = await box(start);

    await expect(suggestionList(page)).toBeVisible();
    expect(await box(start)).toEqual(before);

    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expect(page.getByText(fa.library.recordedLabel)).toBeVisible();
    expect(await box(start)).toEqual(before);

    await page.getByRole('button', { name: fa.library.stop }).click();
    // The lead card holds the one primary action, so Start is hidden while it shows (REQ-075).
    await expect(leadCard(page)).toBeVisible();
    await expect(start).toHaveCount(0);

    await leadCard(page).getByRole('button', { name: fa.library.lead.backToQuestions }).click();
    await expect(suggestionList(page)).toBeVisible();
    expect(await box(start)).toEqual(before);
  });

  test('every control and link of the lead card is a 44 px target, and the card fits the phone width (section 10)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await page.getByRole('button', { name: fa.library.stop }).click();
    const card = leadCard(page);
    await expect(card.getByRole('list', { name: fa.library.lead.followUpsTitle })).toBeVisible();

    const targets = card.locator('a, button');
    // Consultation, four phones, email, website, one follow-up, Other questions.
    await expect(targets).toHaveCount(9);
    const width = page.viewportSize()?.width ?? 0;
    for (const target of await targets.all()) {
      await target.scrollIntoViewIfNeeded();
      const bounds = await box(target);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test('every suggested question and Stop is a 44 px target (section 10)', async ({ page }) => {
    const questions = suggestionList(page).getByRole('button');
    await expect(questions).toHaveCount(2);
    for (const question of await questions.all()) {
      expect((await box(question)).height).toBeGreaterThanOrEqual(44);
    }

    await questions.first().click();
    const stop = page.getByRole('button', { name: fa.library.stop });
    await expect(stop).toBeVisible();
    expect((await box(stop)).height).toBeGreaterThanOrEqual(44);
  });

  test('/video plays the real file from a blob URL, with the label and the caption, and moves focus to the lead card after Stop (REQ-057, REQ-061)', async ({ page }) => {
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();

    await expect(page.getByText(fa.library.recordedLabel)).toBeVisible();
    const caption = page.getByRole('region', { name: fa.library.captionLabel });
    await expect(caption).toHaveText(FIRST_ANSWER);
    await expect(caption).toHaveCSS('direction', 'rtl');
    await expectRecordedAnswerPlaying(page);
    expect((await allSources(page)).some((source) => source.includes('/api/'))).toBe(false);
    // The list is hidden while the answer plays; Stop is in its place.
    await expect(suggestionList(page)).toHaveCount(0);

    await page.getByRole('button', { name: fa.library.stop }).click();

    await expect(
      leadCard(page).getByRole('heading', { name: fa.library.lead.title }),
    ).toBeFocused();
    await expect(recordedVideo(page)).toHaveCount(0);
  });

  test('/audio shows the lead card under the orb, and «Request a consultation» that fails leaves the contact card (REQ-075, REQ-078)', async ({ page }) => {
    await page.route(LIVEAVATAR_API_GLOB, (route) => route.abort());
    await openAudio(page, fa.nav.audio);
    const orb = page.locator('[data-sphere-state]');
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await page.getByRole('button', { name: fa.library.stop }).click();

    await expect(leadCard(page).getByRole('heading', { name: fa.library.lead.title })).toBeFocused();
    await expect(page.getByRole('button', { name: fa.assistant.start })).toHaveCount(0);
    expect((await box(leadCard(page))).y).toBeGreaterThan((await box(orb)).y);

    await leadCard(page).getByRole('button', { name: fa.library.lead.consult }).click();

    // Exact: the orb's caption says the same, with a full stop.
    await expect(page.getByText(fa.assistant.errors.title, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(leadCard(page).getByText(fa.library.lead.liveUnavailable)).toBeVisible();
    await expect(leadCard(page).getByRole('link', { name: 'تماس با دفتر: ۰۲۱ ۲۶۲۳ ۰۰۵۴' })).toHaveAttribute(
      'href',
      'tel:+982126230054',
    );
  });

  test('/audio plays the sound with the orb speaking, the caption shown and no video visible (REQ-058)', async ({ page }) => {
    await openAudio(page, fa.nav.audio);

    await suggestionList(page).getByRole('button', { name: SECOND_QUESTION }).click();

    await expect(page.locator('[data-sphere-state]')).toHaveAttribute('data-sphere-state', 'agent');
    await expect(page.getByRole('region', { name: fa.library.captionLabel })).toBeVisible();
    await expectRecordedAnswerPlaying(page);
    for (const video of await page.locator('video').all()) {
      // Inside the page's `sr-only` wrapper: a 1 px box, heard and never seen.
      expect((await box(video)).width).toBeLessThanOrEqual(1);
    }
  });

  test('a refused autoplay shows "Tap to play the answer", and the tap plays it (REQ-059)', async ({ page }) => {
    // What iOS does after a download took the gesture's time: the next play() is refused once.
    await page.evaluate(() => {
      const realPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function refuseOnce() {
        HTMLMediaElement.prototype.play = realPlay;
        return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
      };
    });

    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    const tap = page.getByRole('button', { name: fa.library.tapToPlay });
    await expect(tap).toBeFocused();

    // The visible pill, in the upper half. The button covers the whole video, so its own center is
    // under Start, which sits on top of it.
    await tap.getByText(fa.library.tapToPlay).click();

    await expect(tap).toHaveCount(0);
    await expectRecordedAnswerPlaying(page);
  });

  test('Start during playback stops the answer and starts the live session (REQ-060)', async ({ page }) => {
    // The live start is held at the provider forever, so the session stays in "connecting".
    await page.route(LIVEAVATAR_API_GLOB, () => {});
    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expectRecordedAnswerPlaying(page);

    await page.getByRole('button', { name: fa.assistant.start }).click();

    await expect(page.getByText(fa.assistant.status.connecting)).toBeVisible();
    await expect(recordedVideo(page)).toHaveCount(0);
    await expect(page.getByText(fa.library.recordedLabel)).toHaveCount(0);
    await expect(suggestionList(page)).toHaveCount(0);
  });

  test('under reduced motion the orb stays still while an answer plays (section 10)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAudio(page, fa.nav.audio);

    await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
    await expect(page.locator('[data-sphere-state]')).toHaveAttribute('data-sphere-state', 'agent');
    await expectRecordedAnswerPlaying(page);

    // The still artwork, and the wrapper at its resting size: no frame loop runs.
    await expect(page.locator('[data-sphere-state] img')).toHaveAttribute(
      'src',
      '/images/ai-voice-still.svg',
    );
    await expect(
      page.locator('[data-sphere-state] > div[aria-hidden="true"]').last(),
    ).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  });
});

test.describe('after a session ends, the next Tab from the ended message reaches "Start again"', () => {
  for (const route of ['/video', '/audio'] as const) {
    test(route, async ({ page }) => {
      // The live start is held at the provider, so End closes a session that never connected.
      await page.route(LIVEAVATAR_API_GLOB, () => {});
      await loginToVideo(page);
      if (route === '/audio') await openAudio(page, fa.nav.audio);
      await page.getByRole('button', { name: fa.assistant.start }).click();
      await page.getByRole('button', { name: fa.assistant.end }).click();

      const restart = page.getByRole('button', { name: fa.assistant.restart });
      await expect(restart).toBeVisible();
      // The page moves the keyboard to the ended message, the news.
      await expect(page.locator('[tabindex="-1"]:focus')).toContainText(
        fa.assistant.ended.title,
      );

      await page.keyboard.press('Tab');

      await expect(restart).toBeFocused();
    });
  }
});

/**
 * REQ-056: on `/audio`, Start sits in the middle at idle, and the orb's
 * box keeps its size and place from idle through the start of the session. Checked with an empty
 * library (English: the library is Persian only), where nothing is under Start, and with
 * suggestions (Persian), where the list leaves as the session starts.
 */
test.describe('the orb keeps its box when Start is pressed (REQ-056)', () => {
  async function expectOrbStillThroughStart(page: Page, labels: { start: string; end: string }) {
    // The live start is held at the provider forever, so the session stays in "connecting".
    await page.route(LIVEAVATAR_API_GLOB, () => {});
    const orb = page.locator('[data-sphere-state]');
    const before = await box(orb);

    await page.getByRole('button', { name: labels.start }).click();

    // The control layer and the notice line are there: the session has started.
    await expect(page.getByRole('button', { name: labels.end })).toBeVisible();
    await expect(page.locator('[data-notice]')).toBeVisible();
    expect(await box(orb)).toEqual(before);
  }

  test('English, with an empty library', async ({ page }) => {
    await loginToVideo(page, { language: 'en' });
    await openAudio(page, 'Audio');
    await expect(page.locator('[data-sphere-state]')).toBeVisible();
    // Settled: the list request has answered, with nothing.
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expect(suggestionList(page, 'Suggested questions')).toHaveCount(0);

    await expectOrbStillThroughStart(page, {
      start: 'Start the conversation',
      end: 'End',
    });
  });

  test('Persian, with suggestions under Start', async ({ page }) => {
    await loginToVideo(page);
    await openAudio(page, fa.nav.audio);
    await expect(suggestionList(page).getByRole('button')).toHaveCount(2);

    await expectOrbStillThroughStart(page, {
      start: fa.assistant.start,
      end: fa.assistant.end,
    });
  });
});

/** The lead card is never clipped in the mobile shell, on a 390 x 844 phone (an iPhone 12 to 14). */
test.describe('in the mobile app on a 390 x 844 phone the whole lead card can be reached', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ['/video', '/audio'] as const) {
    test(`${route}: after an answer, then under a failed consultation start`, async ({ page }) => {
      await page.route(LIVEAVATAR_API_GLOB, (r) => r.abort());
      await loginToVideo(page);
      if (route === '/audio') await openAudio(page, fa.nav.audio);
      await suggestionList(page).getByRole('button', { name: FIRST_QUESTION }).click();
      await page.getByRole('button', { name: fa.library.stop }).click();
      await expect(
        leadCard(page).getByRole('list', { name: fa.library.lead.followUpsTitle }),
      ).toBeVisible();

      await expectLeadCardReachable(page);

      await leadCard(page).getByRole('button', { name: fa.library.lead.consult }).click();
      await expect(leadCard(page).getByText(fa.library.lead.liveUnavailable)).toBeVisible({
        timeout: 15_000,
      });

      await expectLeadCardReachable(page);
    });
  }
});
