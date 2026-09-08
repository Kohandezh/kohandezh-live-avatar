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

  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/$/);
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
