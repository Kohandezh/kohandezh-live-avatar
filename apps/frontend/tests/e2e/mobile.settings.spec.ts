import { expect, test, type Page } from '@playwright/test';

/** A seeded account, already named. Read-only here: only appearance is toggled. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

/**
 * Two phones the seed fixture cannot generate (see mobile.onboarding.spec.ts
 * for why these numbers are safe). Each test below that needs to edit or log
 * out gets its own fresh, unseeded account instead of touching the shared
 * seeded fixture.
 */
const PHONE_FOR_EDIT = '09359999993';
const PHONE_FOR_LOGOUT = '09359999994';

async function loginSeeded(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/video$/);
}

/** Logs in as a brand-new account and clears onboarding with a throwaway name. */
async function loginAndOnboard(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel('First name').fill('Nina');
  await page.getByLabel('Last name').fill('Hosseini');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Start talking' }).click();
  await expect(page).toHaveURL(/\/video$/);
}

/**
 * Goes to `/settings/personal` by clicking through the floating menu and the
 * settings index, never with `page.goto()`. A brand-new account created by
 * `loginAndOnboard` only exists in the mock's in-memory `createdUsers` list
 * for this tab's current page — a `page.goto()` reloads the whole app and
 * that list resets to empty, silently signing the fresh account back out.
 * Clicking through keeps it a client-side route change instead.
 */
async function openPersonalInfo(page: Page) {
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('link', { name: 'Personal information' }).click();
  await expect(page).toHaveURL(/\/settings\/personal$/);
}

test('settings holds what the old header used to (requirement 5)', async ({
  page,
}) => {
  await loginSeeded(page);

  // The old header held the language switcher and the log-in/log-out link.
  // Requirement 6 deletes that header; requirement 5 says its job moves here.
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await expect(page.locator('header')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Language')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Personal information' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Appearance' })).toBeVisible();
});

test('personal information is editable and saves (requirement 15)', async ({
  page,
}) => {
  await loginAndOnboard(page, PHONE_FOR_EDIT);
  await openPersonalInfo(page);

  await expect(page.getByLabel('First name')).toHaveValue('Nina');
  await expect(page.getByLabel('Last name')).toHaveValue('Hosseini');

  const saveButton = page.getByRole('button', { name: 'Save' });
  await expect(saveButton).toBeDisabled();

  await page.getByLabel('First name').fill('Niloofar');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect(page.getByText('Your details were saved.')).toBeVisible();

  // The edit reached the server, not just the local form's own state: leave
  // the page and come back (the mock's session lives in memory for this
  // target, so a full reload would lose it — a client-side round trip
  // through the settings index is the real proof the save persisted).
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('link', { name: 'Personal information' }).click();
  await expect(page.getByLabel('First name')).toHaveValue('Niloofar');
});

test('appearance changes the theme (requirement 15)', async ({ page }) => {
  await loginSeeded(page);
  await page.goto('/settings/appearance');

  // Not `getByRole('radio')`: see mobile.onboarding.spec.ts for why the real
  // input's own bounding box is the wrong click target for HeroUI's Radio.
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('log out lives on the personal info page and works (requirement 15)', async ({
  page,
}) => {
  await loginAndOnboard(page, PHONE_FOR_LOGOUT);
  await openPersonalInfo(page);

  const logoutButton = page.getByRole('button', { name: 'Log out' });
  await expect(logoutButton).toBeVisible();
  await logoutButton.click();

  await expect(page).toHaveURL(/\/$|\/login$/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // A logged-out session cannot get back into a product screen by URL either.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});
