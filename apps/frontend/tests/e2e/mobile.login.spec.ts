import { expect, test } from '@playwright/test';

/** A seeded account. Read-only in every test here: nobody edits its name. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
});

test('the login screen has a title and a subtitle under it (requirements 7, 8)', async ({
  page,
}) => {
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Log in');

  // The subtitle's own text, not just "a paragraph exists" — dropping the
  // subtitle copy would leave a heading with nothing under it.
  await expect(
    page.getByText('Enter your phone number to talk to Dr. Kohandezh.'),
  ).toBeVisible();

  // Then the form (requirement 8).
  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
});

test('there is no old header "Log in" link, and no nav at all (requirement 3)', async ({
  page,
}) => {
  // The heading itself is named "Log in" too, so this has to be a link
  // lookup, not just a text search, or it would pass even with the old
  // header link still in the DOM.
  await expect(
    page.getByRole('link', { name: 'Log in', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('nav')).toHaveCount(0);
});

test('the language control is on the login screen itself, not in a header or nav (requirement 4)', async ({
  page,
}) => {
  // An anonymous visitor has no header and no nav to hold it (requirement 6
  // removes both), so the control has to live directly on the page body.
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.getByLabel('Language')).toBeVisible();
});

test('the OTP step renders six separate slots, not one text box (requirement 11)', async ({
  page,
}) => {
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  // The one real input a screen reader sees stays a single field...
  await expect(page.getByLabel('One-time code')).toHaveCount(1);
  // ...but requirement 11 asks for HeroUI's slotted input-otp, which paints
  // the code as six separate boxes. If a plain single-box <Input> came back,
  // this count would be 0, not 6.
  await expect(page.locator('[data-slot="input-otp-slot"]')).toHaveCount(6);
});

test('a complete code logs the user in with no Verify press (requirement 12)', async ({
  page,
}) => {
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  const verifyButton = page.getByRole('button', { name: 'Verify' });
  await expect(verifyButton).toBeVisible();

  await page.getByLabel('One-time code').fill(OTP_CODE);

  // No click on Verify anywhere above. If auto-submit were removed, the app
  // would sit on /login forever waiting for that click.
  await expect(page).toHaveURL(/\/video$/, { timeout: 10_000 });
});
