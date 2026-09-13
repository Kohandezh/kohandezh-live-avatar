import { expect, test, type Page } from '@playwright/test';

/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

/**
 * Phones the seed fixture cannot generate. `src/data/mock/users.ts` seeds
 * `+989121234567`, `+989351234567`, and `+98990` + a zero-padded index from
 * 0000000 to 0000054. `+989359999991` and `+989359999992` fall in none of
 * those ranges, so the mock backend creates a brand-new account for each,
 * with an empty `firstName` — the "onboarding not done" flag `RequireProfile`
 * reads. Two different numbers so the two tests below never share a session.
 */
const UNSEEDED_PHONE_GRANTED = '09359999991';
const UNSEEDED_PHONE_SKIPPED = '09359999992';

/** Logs in with a brand-new phone and waits for the onboarding redirect. */
async function loginAsNewUser(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/onboarding$/);
}

test.describe('with the microphone permission granted', () => {
  test.use({ permissions: ['microphone'] });

  test('collects the name and appearance, then reaches a granted microphone and /video (requirements 10, 13)', async ({
    page,
  }) => {
    await loginAsNewUser(page, UNSEEDED_PHONE_GRANTED);

    // Step 1: the fresh account's name is empty, not pre-filled from anywhere.
    await expect(
      page.getByRole('heading', { name: 'Tell us about yourself' }),
    ).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue('');
    await expect(page.getByLabel('Last name')).toHaveValue('');

    await page.getByLabel('First name').fill('Sara');
    await page.getByLabel('Last name').fill('Ahmadi');

    // The birthday, typed in the Jalali calendar. The segments are React Aria
    // spinbuttons, not text inputs, so each one is focused and typed into;
    // React Aria moves to the next segment by itself.
    const segment = (type: string) =>
      page.locator(`[data-type="${type}"][role="spinbutton"]`);
    await segment('month').click();
    await page.keyboard.type('3');
    await segment('day').click();
    await page.keyboard.type('31');
    await segment('year').click();
    await page.keyboard.type('1372');

    // Read back as Jalali, never silently reinterpreted as a Gregorian 1372.
    await expect(segment('year')).toHaveText('1372');
    await expect(segment('month')).toHaveAttribute(
      'aria-valuetext',
      /Khordad/,
    );

    await page.getByRole('button', { name: 'Continue' }).click();

    // The birthday is saved along with the name, and the step is cleared, which
    // is the proof the Jalali value converted to a real Gregorian day on the way
    // out: an invalid one would have failed validation and kept us on step 1.

    // Step 2: appearance. Picking "Dark" has to reach <html> immediately,
    // this is the "onboarding done" step's own live preview, not just state
    // held in a form.
    await expect(
      page.getByRole('heading', { name: 'Choose how the app looks' }),
    ).toBeVisible();
    // Not `getByRole('radio')`: HeroUI's Radio keeps the real input inside a
    // `VisuallyHidden` wrapper, sized to its own 1px box rather than the
    // visible circle, so Playwright's own click lands off-target. The label
    // text sits inside the same real `<label>` element the input belongs to,
    // so a click there is what a sighted user actually presses, and the
    // browser's native label/input association does the rest.
    await page.getByText('Dark', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3: the microphone ask, requirement 10. It only happens after
    // login/onboarding, and only on a real button press.
    await expect(
      page.getByRole('heading', { name: 'Allow the microphone' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Allow the microphone' })
      .click();

    // A real getUserMedia round trip, not just a state flip: give it more
    // than the default 5s, especially under a loaded CI worker pool.
    await expect(page.getByText('The microphone is ready.')).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(page).toHaveURL(/\/video$/);
  });
});

test.describe('with no microphone permission granted', () => {
  test('"Not now" still reaches /video (requirement 10)', async ({ page }) => {
    await loginAsNewUser(page, UNSEEDED_PHONE_SKIPPED);

    // No birthday typed at all: the field is optional, so step 1 still clears.
    await page.getByLabel('First name').fill('Reza');
    await page.getByLabel('Last name').fill('Karimi');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Choose how the app looks' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(
      page.getByRole('heading', { name: 'Allow the microphone' }),
    ).toBeVisible();

    // No grant at all: the "not now" escape hatch, which must still land the
    // user on the product's home screen rather than trap them on this step.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(
      page.getByText('You can turn the microphone on later in settings.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(page).toHaveURL(/\/video$/);
  });
});
