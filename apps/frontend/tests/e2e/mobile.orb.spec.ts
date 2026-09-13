import { expect, test, type Page } from '@playwright/test';
import { installFakeLiveAvatarSdk } from './utils/fakeLiveAvatarSdk';

/**
 * The AI Voice orb on /audio (requirement 17).
 *
 * The picture is the user's own SVG artwork, served from `public/` and animating itself with
 * SMIL. Nothing inside an `<img>` can be read from the page, so none of these tests look at
 * the artwork. They look at the two things this app owns: the WRAPPER the speaking cue scales,
 * and the halo behind it.
 *
 * Reaching a genuinely connected session needs the stand-in SDK. See the long header in
 * `mobile.conversation.spec.ts` for why the real one can never connect under Playwright.
 *
 * The stand-in carries no audio track, so `useAvatarAudioLevel` cannot build an analyser and
 * reports null. That is on purpose here: it exercises the synthetic-envelope fallback, which
 * is the path a browser that refuses an AudioContext takes in production.
 */

/** "User Example" — already named in the mock seed data, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** `MOCK_OTP_CODE` in src/data/mock/users.ts. */
const OTP_CODE = '123456';

async function loginAndOpenAudio(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await page.waitForURL('**/video');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Audio' })
    .click();
  await page.waitForURL('**/audio');
}

/** The wrapper the loop scales, and the halo behind it. */
const ORB = '[data-sphere-state]';

/** Reads the scale factor out of the wrapper's inline transform. */
async function readScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('[data-sphere-state]');
    const art = wrapper?.children[1] as HTMLElement | undefined;
    const match = /scale\(([\d.]+)\)/.exec(art?.style.transform ?? '');
    return match ? Number(match[1]) : Number.NaN;
  });
}

async function readHalo(page: Page): Promise<number> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('[data-sphere-state]');
    const halo = wrapper?.children[0] as HTMLElement | undefined;
    return Number(halo?.style.opacity ?? '0');
  });
}

/** Collects the scale over roughly one second of real animation frames. */
async function sampleScale(page: Page, ms = 900): Promise<number[]> {
  return page.evaluate((duration) => {
    const wrapper = document.querySelector('[data-sphere-state]');
    const art = wrapper?.children[1] as HTMLElement;
    const seen: number[] = [];
    return new Promise<number[]>((resolve) => {
      const started = performance.now();
      const tick = () => {
        const match = /scale\(([\d.]+)\)/.exec(art.style.transform);
        if (match) seen.push(Number(match[1]));
        if (performance.now() - started < duration) requestAnimationFrame(tick);
        else resolve(seen);
      };
      requestAnimationFrame(tick);
    });
  }, ms);
}

test('the orb is the user artwork, served as a file and not bundled', async ({
  page,
}) => {
  await loginAndOpenAudio(page);

  const source = await page.locator(`${ORB} img`).getAttribute('src');
  expect(source).toBe('/images/ai-voice.svg');

  // It really is fetched and really is an SVG.
  const response = await page.request.get(source!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('svg');

  // Decorative: the state a screen reader needs is in the live region, not the picture.
  await expect(page.locator(`${ORB} img`)).toHaveAttribute(
    'aria-hidden',
    'true',
  );
});

test('idle, connecting and error all reach the orb', async ({ page }) => {
  await loginAndOpenAudio(page);

  const orb = page.locator(ORB);
  await expect(orb).toHaveAttribute('data-sphere-state', 'idle');
  await expect(orb).toHaveAttribute('data-orb-status', 'idle');

  // No loop before the call is live, so the orb sits at its resting size.
  expect(await readScale(page)).toBe(1);

  // The real SDK cannot connect under Playwright, so pressing start lands on the
  // error state. That is the state being checked here.
  await page.getByRole('button', { name: 'Start the conversation' }).click();
  await expect(orb).toHaveAttribute('data-orb-status', 'error', {
    timeout: 20_000,
  });
  await expect(orb).toHaveAttribute('data-sphere-state', 'ended');
  expect(await readScale(page)).toBe(1);
  expect(await readHalo(page)).toBe(0);
});

test.describe('a genuinely connected call', () => {
  test('the agent speaking breathes the orb, and the user speaking halos it', async ({
    page,
  }) => {
    await installFakeLiveAvatarSdk(page);
    await loginAndOpenAudio(page);

    await page.getByRole('button', { name: 'Start the conversation' }).click();
    // End renders from `requesting` now, not from `connected`: the control layer's lifetime
    // is the session's lifetime, so nothing appears part-way through. The status attribute
    // below is what actually says the call is up.
    await expect(page.getByRole('button', { name: 'End' })).toBeVisible();

    const orb = page.locator(ORB);
    await expect(orb).toHaveAttribute('data-sphere-state', 'idle');
    await expect(orb).toHaveAttribute('data-orb-status', 'connected');

    // --- the agent's turn: the orb breathes ---
    await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
    await expect(orb).toHaveAttribute('data-sphere-state', 'agent');

    const agentScales = await sampleScale(page);
    expect(agentScales.length).toBeGreaterThan(10);
    const agentLow = Math.min(...agentScales);
    const agentHigh = Math.max(...agentScales);

    // It really moves, so the orb reads as talking and not as a still picture.
    expect(agentHigh - agentLow).toBeGreaterThan(0.01);
    // And it stays inside the subtle budget: breathing, never bouncing.
    expect(agentLow).toBeGreaterThanOrEqual(1);
    expect(agentHigh).toBeLessThanOrEqual(1.08);

    // The agent's halo is dim and steady. The size is the cue here.
    expect(await readHalo(page)).toBeCloseTo(0.14, 2);

    // --- the user's turn: the orb holds its size and the halo carries the voice ---
    await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_ended'));
    await page.evaluate(() => window.__liveAvatar.emit('user.speak_started'));
    await expect(orb).toHaveAttribute('data-sphere-state', 'user');

    const userScales = await sampleScale(page);
    const userSwing = Math.max(...userScales) - Math.min(...userScales);

    // The two turns differ in kind. The user's size barely moves...
    expect(userSwing).toBeLessThan(agentHigh - agentLow);
    expect(Math.max(...userScales)).toBeLessThanOrEqual(1.015);
    // ...and the halo, which was dim for the agent, is the bright one now.
    expect(await readHalo(page)).toBeGreaterThan(0.14);
  });

  test('muting and ending both settle the orb, and no control is lost', async ({
    page,
  }) => {
    await installFakeLiveAvatarSdk(page);
    await loginAndOpenAudio(page);

    await page.getByRole('button', { name: 'Start the conversation' }).click();
    await expect(page.getByRole('button', { name: 'End' })).toBeVisible();

    const orb = page.locator(ORB);

    // Every control the screen had before the orb replaced the canvas sphere.
    await expect(page.getByRole('button', { name: 'Mute' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Type instead' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Show the transcript' }),
    ).toBeVisible();
    // Two live regions, by design since the control overhaul. The orb's `sr-only` caption
    // announces who is talking; the notice line carries offline, blocked audio, a denied
    // microphone and the time warning, which were all announced before the overhaul and
    // would have gone silent without it. A bare `getByRole('status')` now matches both, so
    // each one is named instead. The notice is matched by `data-notice` alone, never by its
    // role: a denied microphone rewrites it to `role="alert"`, and a role-based locator
    // would silently stop matching the moment that happens.
    await expect(
      page.locator('[role="status"]:not([data-notice])'),
    ).toBeAttached();
    await expect(page.locator('[data-notice]')).toBeAttached();

    await page.getByRole('button', { name: 'Mute' }).click();
    await expect(orb).toHaveAttribute('data-sphere-state', 'muted');
    // Muted rests at its own size, with no halo.
    expect(await readScale(page)).toBeCloseTo(1, 3);
    expect(await readHalo(page)).toBe(0);

    await page.getByRole('button', { name: 'End' }).click();
    await expect(orb).toHaveAttribute('data-sphere-state', 'ended');
    expect(await readScale(page)).toBe(1);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('swaps the artwork for a still frame and runs no loop at all', async ({
    page,
  }) => {
    await installFakeLiveAvatarSdk(page);
    await loginAndOpenAudio(page);

    // The still file, not the animating one. Swapping the src is the only thing that
    // stops SMIL inside an <img>: the page cannot call pauseAnimations() on it.
    await expect(page.locator(`${ORB} img`)).toHaveAttribute(
      'src',
      '/images/ai-voice-still.svg',
    );
    const still = await page.request.get('/images/ai-voice-still.svg');
    expect(still.status()).toBe(200);
    expect(await still.text()).not.toContain('<animate');

    await page.getByRole('button', { name: 'Start the conversation' }).click();
    // Wait for the status, not for the End button. Since the control overhaul the four
    // controls mount at `requesting`, so End appearing no longer means the SDK has loaded,
    // and `window.__liveAvatar` is still undefined for a few hundred milliseconds while the
    // dynamic import resolves. `data-orb-status` is the real signal, and it is what the
    // other tests in this file already wait for.
    await expect(page.locator(ORB)).toHaveAttribute(
      'data-orb-status',
      'connected',
    );
    await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
    await expect(page.locator(ORB)).toHaveAttribute(
      'data-sphere-state',
      'agent',
    );

    // The state still changes, so a reduced-motion user still knows who is talking.
    // The size does not.
    const scales = await sampleScale(page);
    expect(new Set(scales)).toEqual(new Set([1]));
  });
});
