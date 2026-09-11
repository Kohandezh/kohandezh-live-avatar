import { expect, test } from '@playwright/test';

test('the landing page invites the visitor to start a conversation', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Talk to Dr. Kohandezh, any time.',
  );
  await expect(
    page.getByRole('link', { name: 'Start a conversation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Log in', exact: true }),
  ).toBeVisible();
});

test('a user can log in and see the account page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start a conversation' }).click();

  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();

  // Login lands on the conversation, the product's main screen.
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(
    page.getByRole('heading', { name: 'Conversation with Dr. Kohandezh' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible();
  await expect(page.getByText('User Example')).toBeVisible();
});

test('a signed-in user landing on / goes to the conversation', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/assistant$/);

  await page.goto('/');

  await expect(page).toHaveURL(/\/assistant$/);
});

test('the avatar console link is hidden from normal users', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/assistant$/);

  await expect(
    page.getByRole('link', { name: 'Avatar console' }),
  ).toBeHidden();
});

test('switching to Persian sets RTL direction', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Language').click();
  await page.getByRole('option', { name: 'فارسی' }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'هر زمان با دکتر کهن‌دژ گفتگو کنید.',
  );
});
