import { expect, test, type Page } from '@playwright/test';

/**
 * The admin app shares `PhoneLoginForm` with the product targets, so it gets
 * the same HeroUI `input-otp` and the same auto-submit (requirements 11, 12):
 * filling the six digits logs in on its own, with no Verify click.
 */
async function login(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
}

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
});

test('an admin sees the dashboard and the users table', async ({ page }) => {
  await login(page, '09121234567');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Total users')).toBeVisible();

  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(11);
});

test('a normal user is blocked', async ({ page }) => {
  await login(page, '09351234567');

  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
});
