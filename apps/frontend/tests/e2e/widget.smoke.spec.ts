import { expect, test } from '@playwright/test';

// The demo page loads the widget with data-lang="fa", so the UI starts in Persian.
// Playwright locators reach into the Shadow DOM, so no extra handle is needed.

test('the launcher opens the assistant panel', async ({ page }) => {
  await page.goto('/');

  const launcher = page.getByRole('button', { name: 'باز کردن دستیار' });
  await expect(launcher).toBeVisible();

  await launcher.click();

  const panel = page.getByRole('dialog', { name: 'دستیار' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'شروع گفتگو' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('the panel switches to English', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'باز کردن دستیار' }).click();
  await page.getByRole('button', { name: 'English' }).click();

  await expect(page.getByRole('dialog', { name: 'Assistant' })).toBeVisible();
});
