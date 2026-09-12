import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshot spec, not an assertion spec. Walks to each of the three new
 * screens (plus login, onboarding, settings, appearance, and the Persian
 * login) and saves a full-page PNG for a human to look at.
 *
 * Every screenshot waits for that screen's own heading or control first,
 * never a bare timeout, so a PNG that claims to be one screen cannot
 * silently be a loading state or the previous screen instead.
 */

/**
 * Inside the repo by default, so this runs anywhere. `test-results/` is
 * already git-ignored and is wiped between runs, which is what we want:
 * the shots always describe the current build.
 *
 * Set `SCREENSHOT_DIR` to collect them somewhere else, for example to keep
 * a before-and-after pair while working on the look.
 */
const SCREENSHOT_DIR =
  process.env.SCREENSHOT_DIR ??
  path.join(process.cwd(), 'test-results', 'screens');

/** "User Example" — already has a name in the mock seed data, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/**
 * Not in the generated seed range: `src/data/mock/users.ts` only generates
 * phones under the `+98990` prefix (`phoneFor`), and the two fixed demo
 * accounts are `+989121234567` and `+989351234567`. This number matches
 * none of those, so logging in with it creates a fresh account with an
 * empty name, which is what sends a new user to onboarding.
 */
const UNSEEDED_PHONE = '09391234567';
/** `MOCK_OTP_CODE` in src/data/mock/users.ts. Accepted for every mock account. */
const OTP_CODE = '123456';

test.beforeAll(() => {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

async function fillPhoneAndSendCode(page: Page, phone: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  // No Verify click: requirement 12 auto-submits a complete code.
}

test('01: login screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Send code' }),
  ).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/01-login.png`,
    fullPage: true,
  });
});

test('02: onboarding, name step', async ({ page }) => {
  await fillPhoneAndSendCode(page, UNSEEDED_PHONE);
  await page.waitForURL('**/onboarding');
  await expect(
    page.getByRole('heading', { name: 'What should we call you?' }),
  ).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/02-onboarding-name.png`,
    fullPage: true,
  });
});

test('03: video, idle', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await expect(
    page.getByRole('button', { name: 'Start the conversation' }),
  ).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/03-video-idle.png`,
    fullPage: true,
  });
});

test('04: audio, sphere idle', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Audio' })
    .click();
  await page.waitForURL('**/audio');
  await expect(page.locator('[data-sphere-state="idle"]')).toBeVisible();
  // Two elements carry this text on purpose (AssistantSphere.tsx): a
  // sighted-user caption and a debounced sr-only live region. `.first()`
  // is the visible caption.
  await expect(page.getByText('Press start, then speak.').first()).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/04-audio-sphere.png`,
    fullPage: true,
  });
});

test('05: settings index', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.waitForURL('**/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/05-settings-index.png`,
    fullPage: true,
  });
});

test('06: appearance, dark', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.waitForURL('**/settings');
  await page.getByRole('link', { name: 'Appearance' }).click();
  await page.waitForURL('**/settings/appearance');
  await expect(
    page.getByRole('heading', { name: 'Appearance' }),
  ).toBeVisible();

  // The custom-styled radio's own hit target sits under HeroUI's animated
  // control graphic, which Playwright's actionability check treats as an
  // interceptor mid-transition. `force` is safe here: this is a visual
  // overlay race, not a real disabled/hidden state (already proven above by
  // resolving the role and its accessible name).
  await page.getByRole('radio', { name: 'Dark' }).click({ force: true });
  // ThemeSync applies the class in a layout effect; wait for the real
  // effect instead of a timeout so the screenshot cannot race it.
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/06-appearance-dark.png`,
    fullPage: true,
  });
});

test('07: login screen, Persian RTL', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'فارسی' }).click();

  // LanguageSync sets `dir` on <html>; wait for the real effect, not a timeout.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/07-login-rtl-fa.png`,
    fullPage: true,
  });
});

/**
 * The two dark-mode screens the reference image is really about. The audio
 * screen follows the app theme rather than forcing its own dark ground, so
 * the only way to see the reference look is to switch the theme first.
 */
async function switchToDark(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.waitForURL('**/settings');
  await page.getByRole('link', { name: 'Appearance' }).click();
  await page.waitForURL('**/settings/appearance');
  // See the note in test 06: the animated control graphic intercepts the
  // press mid-transition, which is a visual race and not a real blocked state.
  await page.getByRole('radio', { name: 'Dark' }).click({ force: true });
  await expect(page.locator('html')).toHaveClass(/dark/);
}

test('08: audio sphere, dark', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await switchToDark(page);

  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Audio' })
    .click();
  await page.waitForURL('**/audio');
  await expect(page.locator('[data-sphere-state]')).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/08-audio-sphere-dark.png`,
    fullPage: true,
  });
});

test('09: settings index, dark', async ({ page }) => {
  await fillPhoneAndSendCode(page, SEEDED_PHONE);
  await page.waitForURL('**/video');
  await switchToDark(page);

  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.waitForURL('**/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.screenshot({
    path: `${SCREENSHOT_DIR}/09-settings-index-dark.png`,
    fullPage: true,
  });
});
