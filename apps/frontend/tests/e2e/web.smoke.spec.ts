import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Cross-Platform App',
  );
  await expect(
    page.getByRole('link', { name: 'Log in', exact: true }),
  ).toBeVisible();
});

test('a user can log in and see the profile', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();

  // Login lands on the assistant, the product's main screen.
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(
    page.getByRole('button', { name: 'Start the conversation' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('User Example')).toBeVisible();
});

test('switching to Persian sets RTL direction', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Language').selectOption('fa');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'اپلیکیشن چندسکویی',
  );
});
