import { expect, test, type Page } from '@playwright/test';

/** A seeded account. Already has a name, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

async function login(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  // No Verify click: requirement 12 is a complete code logs in on its own.
  await page.getByRole('heading', { name: 'Log in' }).waitFor({ state: 'detached' });
}

test('an anonymous visitor at / sees only the login form (requirement 1)', async ({
  page,
}) => {
  await page.goto('/');

  // If requirement 1 were dropped, this would still be the old landing page
  // heading ("Talk to Dr. Kohandezh, any time.") instead of the login title.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
  await expect(page.getByLabel('Phone number')).toBeVisible();

  // "and nothing else": no chrome at all for a visitor who is not signed in.
  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('no <header> element exists on any product screen (requirement 6)', async ({
  page,
}) => {
  // Anonymous.
  await page.goto('/');
  await expect(page.locator('header')).toHaveCount(0);

  // Signed in, on the product screens.
  await login(page, SEEDED_PHONE);
  await expect(page).toHaveURL(/\/video$/);
  await expect(page.locator('header')).toHaveCount(0);

  await page.goto('/settings');
  await expect(page.locator('header')).toHaveCount(0);
});

test('after login the floating menu has exactly three items (requirement 14)', async ({
  page,
}) => {
  await login(page, SEEDED_PHONE);
  await expect(page).toHaveURL(/\/video$/);

  const menu = page.getByRole('navigation', { name: 'Menu' });
  await expect(menu).toBeVisible();

  // If a fourth item crept in (or one of the three were dropped), this count
  // would no longer be 3 — this is not a test that can never fail.
  const items = menu.getByRole('button');
  await expect(items).toHaveCount(3);
  await expect(menu.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Video' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Audio' })).toBeVisible();
});
