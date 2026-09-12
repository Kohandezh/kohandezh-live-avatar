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

  const themeList = page.getByRole('listbox', { name: 'Theme' });

  await themeList.getByRole('option', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(themeList.getByRole('option', { name: 'Dark' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await themeList.getByRole('option', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // A single-select list box must never end up with nothing chosen.
  await expect(themeList.locator('[aria-selected="true"]')).toHaveCount(1);
});

test('the transparency slider dials the glass down by degrees (requirement 15)', async ({
  page,
}) => {
  await loginSeeded(page);
  await page.goto('/settings/appearance');

  // React Aria backs the slider with a real <input type="range">, so the value
  // is the input's own value, not an aria-valuenow attribute.
  const slider = page.getByRole('slider', { name: 'Reduce transparency' });
  await expect(slider).toHaveValue('0');

  // A real drag on the track, not just keys: this is how the control is used.
  const track = page.locator('[data-slot="slider-track"]').first();
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  const middle = Number(await slider.inputValue());
  expect(middle).toBeGreaterThan(0);
  expect(middle).toBeLessThan(100);

  // A level in between scales the glass rather than switching it off, so the
  // custom property moves while the full-flat attribute stays off.
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'false',
  );
  const factor = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--glass-reduce'),
  );
  expect(Number(factor)).toBeCloseTo(middle / 100, 5);

  // The top of the scale drops the backdrop filter outright.
  await slider.press('End');
  await expect(slider).toHaveValue('100');
  await expect(page.locator('html')).toHaveAttribute(
    'data-reduce-transparency',
    'true',
  );
  const barFilter = await page
    .getByRole('navigation', { name: 'Menu' })
    .evaluate((el) => {
      const glass = el.querySelector('.glass') ?? el;
      return getComputedStyle(glass).backdropFilter;
    });
  expect(barFilter).toBe('none');
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

/**
 * The floating menu has to keep showing which screen you are on once you go
 * one level deeper into settings.
 *
 * This regressed: the bar swapped `NavLink` for guarded buttons (amendment 1)
 * and set `aria-current` by hand with an exact path comparison, so on
 * `/settings/personal` and `/settings/appearance` no item was current at all
 * — the user was inside settings and the menu showed nothing selected.
 */
test('the menu keeps Settings current inside its sub-pages (requirement 14)', async ({
  page,
}) => {
  await loginSeeded(page);

  const menu = page.getByRole('navigation', { name: 'Menu' });
  const settingsItem = menu.getByRole('button', { name: 'Settings' });
  const videoItem = menu.getByRole('button', { name: 'Video' });

  // On /video it is Video that is current, not Settings.
  await expect(videoItem).toHaveAttribute('aria-current', 'page');
  await expect(settingsItem).not.toHaveAttribute('aria-current', 'page');

  await settingsItem.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(settingsItem).toHaveAttribute('aria-current', 'page');

  // One level deeper: still Settings, and still only Settings.
  for (const [link, path] of [
    ['Appearance', /\/settings\/appearance$/],
    ['Personal information', /\/settings\/personal$/],
  ] as const) {
    await page.getByRole('link', { name: link }).click();
    await expect(page).toHaveURL(path);
    // Wait for the sub-page itself to render before reading the menu.
    // The URL changes before React commits the new tree, and until it does
    // the bar still carries the PREVIOUS route's `aria-current` — so an
    // assertion made right after `toHaveURL` can pass on a stale attribute
    // and never see the bug it was written for.
    await expect(
      page.getByRole('heading', { level: 1, name: link }),
    ).toBeVisible();
    await expect(
      settingsItem,
      `Settings should stay current on ${link}`,
    ).toHaveAttribute('aria-current', 'page');
    await expect(videoItem).not.toHaveAttribute('aria-current', 'page');
    // Exactly one item is ever current.
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
  }
});
