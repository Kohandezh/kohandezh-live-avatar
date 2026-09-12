import { expect, test } from '@playwright/test';

/** A seeded account. Already has a name, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

test('an anonymous visitor at / sees only the login form (requirement 1)', async ({
  page,
}) => {
  await page.goto('/');

  // If requirement 1 were dropped, this would still be the old landing page
  // heading ("Talk to Dr. Kohandezh, any time.") instead of the login title.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByLabel('Phone number')).toBeVisible();
});

test('there is no header, no old "Log in" link, and no language control in any chrome (requirements 2, 3, 4, 6)', async ({
  page,
}) => {
  await page.goto('/');

  // No header and no nav at all for an anonymous visitor: requirement 6
  // removes the header, and requirement 14's floating menu is signed-in only.
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.locator('nav')).toHaveCount(0);

  // The old header's own link, by role, not by text: the login title is also
  // named "Log in", so a text-only search would pass even with the link
  // still in the DOM.
  await expect(
    page.getByRole('link', { name: 'Log in', exact: true }),
  ).toHaveCount(0);

  // The language control still exists (requirement 4 only says it leaves the
  // header), just directly on the login screen since there is no header or
  // nav left to hold it.
  await expect(page.getByLabel('Language')).toBeVisible();

  // Signed in, product screens keep the same rule: no header anywhere.
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.locator('header')).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator('header')).toHaveCount(0);
});

test('there is no footer and no copyright text anywhere (requirement 9)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.getByText(/©|copyright/i)).toHaveCount(0);

  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/video$/);

  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.getByText(/©|copyright/i)).toHaveCount(0);
});

test('switching the interface to Persian sets RTL and shows Persian text', async ({
  page,
}) => {
  // Re-homed from the old header control (requirement 4 removes it from
  // there) to the login screen, the one place a signed-out visitor can still
  // reach a language switcher.
  await page.goto('/');

  await page.getByLabel('Language').click();
  await page.getByRole('option', { name: 'فارسی' }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ورود');
  await expect(
    page.getByText('برای گفتگو با دکتر کهن‌دژ شمارهٔ موبایل خود را وارد کنید.'),
  ).toBeVisible();
});
