import { expect, test, type Page } from '@playwright/test';
import { installFakeLiveAvatarSdk } from './utils/fakeLiveAvatarSdk';

/**
 * Requirements 16, 17, 18, 19 — the video screen, the audio sphere, the
 * navigation guard, and the video/audio switch confirm.
 *
 * WHAT THIS FILE CANNOT TEST, AND WHY (read this before changing anything)
 * --------------------------------------------------------------------
 * `VITE_API_MOCK=true` only fakes OUR OWN backend
 * (`/api/assistant/session`, ...). It hands the frontend a fake
 * `sessionToken` ('mock-session-token'), but the real
 * `@heygen/liveavatar-web-sdk` package still runs in the browser — see
 * `src/features/assistant/useAssistantSession.ts`. That SDK is only ever
 * swapped for a fake one inside vitest, through
 * `vi.mock('@heygen/liveavatar-web-sdk', ...)` and
 * `tests/utils/liveAvatarSdkMock.ts`. Playwright drives a real browser, so
 * no `vi.mock` reaches it and the real SDK is what runs.
 *
 * That means a genuinely connected conversation (status "connected", an
 * avatar that actually speaks, `data-sphere-state` "user" / "agent" /
 * "muted") cannot be produced from this file. Pressing "Start the
 * conversation" makes the real SDK call `https://api.liveavatar.com/v1/
 * sessions/start` with the fake token, which a real server would reject —
 * left alone, that is a slow, flaky call to a third party for every test
 * run. So every test below that needs "a session is live" intercepts that
 * one URL and never answers it.
 *
 * That interception is not just a way to avoid the network call — it is
 * also what makes "live" reachable at all. Reading
 * `useAssistantSession.ts`: `dispatch({ type: 'connecting' })` runs
 * *before* `await session.start()`, and `useConversationScreen.ts` counts
 * both "requesting" and "connecting" as live (`LIVE_STATUSES`). So a
 * session that never gets an answer from `api.liveavatar.com` sits in
 * "connecting" — genuinely live, by the app's own definition — for as long
 * as the test wants, with no race and no real network call ever leaving
 * the browser.
 *
 * `isAvatarSpeaking` needs more than a frozen request: it only flips to
 * true on the SDK's own `AVATAR_SPEAK_STARTED` event, which needs a session
 * that actually finished connecting. `utils/fakeLiveAvatarSdk.ts` supplies
 * that by serving a stand-in module in place of the SDK — the hook loads it
 * with a dynamic `import()`, so replacing that one URL swaps the whole SDK
 * without the app knowing. The tests that need a genuinely connected,
 * speaking avatar call `installFakeLiveAvatarSdk(page)` first.
 *
 * Two ways to reach "live" therefore live side by side, on purpose:
 *   - `startAndFreezeConnecting` — the real SDK, parked in "connecting".
 *     Proves the guard treats a not-yet-connected session as live.
 *   - `installFakeLiveAvatarSdk` — a fully connected session that can be
 *     driven through speaking, muting and stopping.
 */

/** "User Example" — already has a name in the mock seed data, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** `MOCK_OTP_CODE` in src/data/mock/users.ts. Accepted for every mock account. */
const OTP_CODE = '123456';

/** The real SDK's own base URL (`API_URL` in `@heygen/liveavatar-web-sdk`). Never our mock. */
const LIVEAVATAR_API_GLOB = 'https://api.liveavatar.com/**';

async function loginWithSeededUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  // No Verify click: requirement 12 auto-submits a complete code.
  await page.waitForURL('**/video');
}

/**
 * Presses Start and freezes the session in "connecting" forever, by never
 * answering the real SDK's one HTTP call. See the file header for why this
 * is the only safe way to reach a "live" session in this suite.
 */
async function startAndFreezeConnecting(page: Page): Promise<void> {
  await page.route(LIVEAVATAR_API_GLOB, () => {
    // Deliberately never call fulfill/continue/abort: the request stays
    // pending, so `await session.start()` in useAssistantSession.ts never
    // resolves and the status never leaves "connecting".
  });
  await page.getByRole('button', { name: 'Start the conversation' }).click();
  // "Preparing…" (requesting) is the mock backend call and settles almost
  // immediately; "Connecting…" is the frozen one. Waiting for the frozen
  // text is what makes the rest of the test deterministic. Two elements
  // show it at once (the status chip and the busy caption below the
  // button); `.first()` is enough to prove either has appeared.
  await expect(page.getByText('Connecting…').first()).toBeVisible();
}

/**
 * Wait until the session is genuinely connected.
 *
 * Not "until End appears". Since `/video` moved to the shared control layer all
 * four circles mount at `requesting`, so End is on screen a few hundred
 * milliseconds before the dynamic import of the SDK has even resolved, and
 * `window.__liveAvatar` is still undefined at that point. The microphone drops
 * its `aria-disabled` only when `canControl` is true, which is the app saying
 * the session can take a control. `/audio` waits on `data-orb-status` for the
 * same reason; this screen has no orb.
 */
async function waitForConnected(page: Page) {
  await expect(page.getByRole('button', { name: 'Mute' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
}

test.describe('requirement 16: the video screen', () => {
  test('idle shows exactly one enabled control, over a full-bleed stage', async ({
    page,
  }) => {
    await loginWithSeededUser(page);

    const main = page.locator('main');

    // The screen's only heading, present for a screen reader even though
    // requirement 16 asks for no visible title on this screen.
    await expect(
      main.getByRole('heading', { level: 1, name: 'Video conversation' }),
    ).toBeAttached();

    // Exactly one control in the stage area, and it is the start button.
    const controls = main.getByRole('button');
    await expect(controls).toHaveCount(1);
    const startButton = controls.first();
    await expect(startButton).toBeEnabled();
    await expect(startButton).toHaveAccessibleName('Start the conversation');

    // No status chips, no mute/end row: those only appear once a session exists.
    await expect(main.getByRole('button', { name: 'End' })).toHaveCount(0);

    // `ConversationStage` records what it is actually showing in
    // `data-stage-mode`, because a canvas/video background cannot be
    // asserted by pixels. `VITE_ASSISTANT_PREVIEW_VIDEO` is unset for every
    // e2e dev server (checked in .env.development and .env.development.local),
    // so the code takes the ambient-fallback branch, not the <video> loop.
    // A run with that variable set would need this assertion changed to
    // "preview", and would then be able to assert a visible <video> loop —
    // neither is tested here, so this line only proves the fallback path,
    // never both at once.
    const stage = page.locator('[data-stage-mode]');
    await expect(stage).toHaveAttribute('data-stage-mode', 'ambient');

    // "Full width and height, 16:9": the stage itself is deliberately full
    // bleed (a literal 16:9 box on a portrait phone would cover about a
    // quarter of the screen — see UX_OVERHAUL_DESIGN.md section D11), and
    // the 16:9 shape belongs to the chrome column that holds the button
    // instead (`stage-16x9` in globals.css). On a portrait phone the
    // column's readable-width cap is what binds, so the ratio is only
    // visible on a short, wide window; both cases are checked below.
    const stageBox = await stage.boundingBox();
    const mainBox = await main.boundingBox();
    expect(stageBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    // The stage fills its container: this is the "full width and height" half.
    // `<main>` must NOT add `dock-clear` padding on this route, so the stage
    // and `<main>` are the same box.
    expect(Math.abs(stageBox!.width - mainBox!.width)).toBeLessThan(2);
    expect(Math.abs(stageBox!.height - mainBox!.height)).toBeLessThan(2);

    /**
     * The stage has to run all the way to the bottom edge, UNDER the floating
     * menu — that is the whole reason the menu is glass and why the bar sets
     * `data-glass="strong"` "for use over video" (design section D2).
     *
     * This regressed once: `<main>` carried `dock-clear` for every route, so
     * the stage stopped ~84px short and the glass pill floated on a flat band
     * of page background with nothing behind it to blur.
     */
    const viewportHeight = page.viewportSize()!.height;
    expect(
      Math.abs(stageBox!.y + stageBox!.height - viewportHeight),
      'the stage must reach the bottom edge of the viewport',
    ).toBeLessThan(2);

    const dockBox = await page
      .getByRole('navigation', { name: 'Menu' })
      .boundingBox();
    expect(dockBox).not.toBeNull();
    const dockSitsOverStage =
      dockBox!.y < stageBox!.y + stageBox!.height &&
      dockBox!.y + dockBox!.height > stageBox!.y;
    expect(dockSitsOverStage, 'the floating menu must overlap the stage').toBe(
      true,
    );
    // And it must still be the thing a tap lands on.
    const dockHitsItself = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label]')!;
      const r = nav.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2),
      );
      return nav.contains(hit);
    });
    expect(dockHitsItself, 'the floating menu must be on top').toBe(true);

    const heading = main.getByRole('heading', {
      level: 1,
      name: 'Video conversation',
    });

    // The safe-area column is the heading's own parent (see
    // VideoConversationPage.tsx: the sr-only <h1> is a direct child of the
    // `stage-safe-top stage-16x9 ...` column). Reached through an accessible
    // query, not a class name, so this stays a behavioural check: it reads
    // real rendered geometry, not markup.
    const safeArea = heading.locator('xpath=..');

    /**
     * The rule `stage-16x9` has to keep (globals.css): the chrome column is
     * never WIDER than the 16:9 region its own height allows. The column is
     * always `--dock-clearance` shorter than the viewport, because it sits
     * inside `<main>`, which carries `dock-clear`. So the ratio has to be
     * computed from the column's real measured height, never from `100dvh`.
     *
     * Asserting this at several viewports is the point. An earlier version
     * of this test checked a single hand-picked viewport, and that passed
     * against a broken `calc(100dvh*16/9)` that overstated the width by
     * ~150px: at 740x400 it drew a 672x316 column, a 2.13 ratio, wider than
     * the 16:9 frame it exists to stay inside.
     */
    /**
     * Returns the column's width and the height the ratio is actually about.
     *
     * The column now spans the full viewport and reserves the menu's space as
     * its OWN `dock-clear` bottom padding, so its outer box is taller than the
     * region the chrome can use. Subtracting that padding gives exactly the
     * height `stage-16x9` computes from (`100dvh - var(--dock-clearance)`),
     * which is also the height a user actually sees the chrome inside.
     */
    const measure = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      const box = await safeArea.boundingBox();
      expect(box, `no box at ${width}x${height}`).not.toBeNull();
      const padBottom = await safeArea.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingBottom),
      );
      return { width: box!.width, height: box!.height - padBottom };
    };

    // Short and wide: the ratio branch binds, so the column is exactly 16:9
    // and visibly narrower than the window.
    for (const [width, height] of [
      [740, 400],
      [1000, 462],
    ] as const) {
      const box = await measure(width, height);
      expect(box.width).toBeLessThan(width - 50);
      const ratio = box.width / box.height;
      expect(
        Math.abs(ratio - 16 / 9),
        `column should be 16:9 at ${width}x${height}, got ${ratio.toFixed(3)}`,
      ).toBeLessThan(0.05);
    }

    // Taller windows: the 42rem readable cap binds instead, so the column is
    // narrower than 16:9 would allow. It must never be wider.
    for (const [width, height] of [
      [900, 600],
      [1280, 800],
      [412, 915],
    ] as const) {
      const box = await measure(width, height);
      const widest = (box.height * 16) / 9;
      expect(
        box.width,
        `column is wider than its own 16:9 region at ${width}x${height}`,
      ).toBeLessThanOrEqual(widest + 1);
    }
  });
});

test.describe('requirement 17: the audio sphere', () => {
  test('idle sphere state and live region reflect nobody holding the turn', async ({
    page,
  }) => {
    await loginWithSeededUser(page);
    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();
    await page.waitForURL('**/audio');

    // `AssistantSphere` exposes `data-sphere-state` because a canvas has no
    // DOM a test can read. Idle is the only state reachable here — see the
    // file header for why "user" / "agent" / "muted" need a real connection
    // this mock cannot provide, and are covered by the vitest suite instead.
    const sphere = page.locator('[data-sphere-state]');
    await expect(sphere).toHaveAttribute('data-sphere-state', 'idle');

    // The sighted-user caption updates immediately. Two elements carry this
    // text on purpose (the caption plus the debounced sr-only live region
    // checked below), so `.first()` picks the visible one.
    await expect(
      page.getByText('Press start, then speak.').first(),
    ).toBeVisible();

    // The sr-only live region is debounced by 800ms (AssistantSphere.tsx),
    // so it must be read after that window, not right away. It is picked by
    // its text: while the suggested questions load, their spinner is a
    // `status` too.
    const liveRegion = page
      .getByRole('status')
      .filter({ hasText: 'Press start, then speak.' });
    await expect(liveRegion).toHaveText('Press start, then speak.', {
      timeout: 2000,
    });
  });
});

test.describe('requirements 18 and 19: the navigation guard', () => {
  test('switching screens while idle is immediate: no dialog, no toast', async ({
    page,
  }) => {
    await loginWithSeededUser(page);

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();

    await page.waitForURL('**/audio');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // HeroUI's toast renders as a status/alert region; none should exist here.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('switching screens while a session is live asks for confirmation, and cancel stays put', async ({
    page,
  }) => {
    await loginWithSeededUser(page);
    await startAndFreezeConnecting(page);

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('End this conversation?');
    await expect(dialog).toContainText(
      'Moving to another screen ends the conversation.',
    );

    await dialog.getByRole('button', { name: 'Stay here' }).click();

    await expect(dialog).toBeHidden();
    // Cancelling really stayed: still on /video, and the session is still
    // the frozen "connecting" one, not restarted or dropped.
    await expect(page).toHaveURL(/\/video$/);
    await expect(page.getByText('Connecting…').first()).toBeVisible();
  });

  test('confirming the switch leaves the video screen and lands on audio', async ({
    page,
  }) => {
    await loginWithSeededUser(page);
    await startAndFreezeConnecting(page);

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();

    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'End and continue' }).click();

    await expect(page).toHaveURL(/\/audio$/);
    await expect(dialog).toBeHidden();
    // Requirement 19 says the switch ENDS the session (not just navigates):
    // unmounting VideoConversationPage runs useAssistantSession's own
    // cleanup, which is exercised, not re-asserted by network call counts
    // here — that belongs to the integration suite, which can see the
    // mocked SDK's stop() call. What is observable from here is that the
    // new /audio screen starts a session of its own, from idle: the sphere
    // is idle, and Start is available again rather than the screen coming
    // up already "connecting".
    await expect(page.locator('[data-sphere-state]')).toHaveAttribute(
      'data-sphere-state',
      'idle',
    );
    await expect(
      page.getByRole('button', { name: 'Start the conversation' }),
    ).toBeEnabled();
  });

  /**
   * The other half of requirement 18: while the avatar is SPEAKING, a tap is
   * refused outright with a toast, and does not even offer the dialog.
   *
   * `isAvatarSpeaking` only flips on the SDK's `AVATAR_SPEAK_STARTED` event,
   * which needs a session that really finished connecting. The fake module in
   * `utils/fakeLiveAvatarSdk.ts` supplies exactly that, by replacing the one
   * dynamic `import()` the hook makes. No product code is aware of it.
   */
  test('a tap while the avatar is speaking is refused with a toast, and does not navigate', async ({
    page,
  }) => {
    await installFakeLiveAvatarSdk(page);
    await loginWithSeededUser(page);

    await page.getByRole('button', { name: 'Start the conversation' }).click();
    await waitForConnected(page);

    await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));

    // Interrupt is always on screen now, so its presence proves nothing. It
    // becomes pressable only while the avatar holds the turn, and that is the
    // app's own confirmation that the flag really flipped.
    await expect(
      page.getByRole('button', { name: 'Interrupt' }),
    ).not.toHaveAttribute('aria-disabled', 'true');

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();

    // Refused, and refused with an explanation.
    await expect(
      page.getByText('Wait until the answer finishes.'),
    ).toBeVisible();
    // A blocked tap is not the confirm path: no dialog may appear.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Still on /video, and the call is still up.
    expect(new URL(page.url()).pathname).toBe('/video');
    expect(await page.evaluate(() => window.__liveAvatar.stopCount)).toBe(0);
    await expect(page.getByRole('button', { name: 'End' })).toBeVisible();

    // Once the avatar stops speaking the same tap is allowed again — this
    // time reaching the confirm dialog, because the session is still live.
    await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_ended'));
    // `useSpeakingHold` keeps the control live for 800 ms after the avatar
    // stops, so interrupt changes state once per answer instead of blinking
    // with every speech segment. Wait that out rather than racing it.
    await expect(page.getByRole('button', { name: 'Interrupt' })).toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 5_000 },
    );

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  });

  /**
   * Requirement 19 end to end, against a session that genuinely connected:
   * confirming really stops the provider session, not just the route.
   */
  test('confirming the switch on a connected call stops the provider session', async ({
    page,
  }) => {
    await installFakeLiveAvatarSdk(page);
    await loginWithSeededUser(page);

    await page.getByRole('button', { name: 'Start the conversation' }).click();
    await waitForConnected(page);
    expect(await page.evaluate(() => window.__liveAvatar.isOpen)).toBe(true);

    await page
      .getByRole('navigation', { name: 'Menu' })
      .getByRole('button', { name: 'Audio' })
      .click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'End and continue' }).click();

    await page.waitForURL('**/audio');
    // Unmounting the page must have closed the provider session (amendment 1:
    // "switching video to audio ends the conversation").
    await expect
      .poll(() => page.evaluate(() => window.__liveAvatar.stopCount))
      .toBe(1);
    expect(await page.evaluate(() => window.__liveAvatar.isOpen)).toBe(false);
  });
});
