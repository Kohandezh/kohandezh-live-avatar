import { expect, test } from '@playwright/test';

test('home page renders with the bottom tab bar', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Cross-Platform App',
  );
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeVisible();
});

test('profile tab asks anonymous users to log in', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: 'Profile', exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
});
