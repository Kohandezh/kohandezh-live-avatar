import { expect, test } from '@playwright/test';

test('the landing page has no tab bar for anonymous visitors', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Talk to Dr. Kohandezh, any time.',
  );
  await expect(page.getByRole('navigation', { name: 'Menu' })).toBeHidden();
});

test('the start button leads to the login screen', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('link', { name: 'Start a conversation' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

test('after login the tab bar shows the conversation and the account', async ({
  page,
}) => {
  await page.goto('/login');

  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page).toHaveURL(/\/assistant$/);

  const tabs = page.getByRole('navigation', { name: 'Menu' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link')).toHaveCount(2);

  await tabs.getByRole('link', { name: 'Profile' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible();
});
