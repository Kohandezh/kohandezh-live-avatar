import { expect, test, type Page } from '@playwright/test';

/*
 * The answer library in the admin target, against the in-browser mock API. The mock seed holds
 * one entry in each status (src/data/mock/handlers.ts): C4Q01 pending, C4Q02 ready, C4Q03 draft,
 * C4Q04 withdrawn, C3Q01 and C3Q02 published. Every page load starts from that seed.
 */

/** Seeded admin and user accounts; the one-time code is fixed in the mock. */
const ADMIN_PHONE = '09121234567';
const USER_PHONE = '09351234567';

async function login(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
}

async function openLibrary(page: Page) {
  await login(page, ADMIN_PHONE);
  await page.getByRole('link', { name: 'Answer library' }).click();
  await expect(
    page.getByRole('heading', { name: 'Answer library', level: 1 }),
  ).toBeVisible();
}

async function openEntry(page: Page, key: string) {
  await page.getByRole('grid').getByText(key, { exact: true }).click();
  const panel = page.getByRole('dialog', { name: `Answer ${key}` });
  await expect(panel).toBeVisible();
  return panel;
}

test('the nav reaches the library, which lists every entry (REQ-030, REQ-031)', async ({
  page,
}) => {
  await openLibrary(page);

  await expect(page).toHaveURL(/\/library$/);
  // Header row plus the six seed entries.
  await expect(page.getByRole('row')).toHaveCount(7);
  await expect(page.getByText('Page 1 of 1 · 6 answers')).toBeVisible();
});

test('rewrite a pending answer, mark it ready, then review and publish a draft (REQ-032, REQ-073)', async ({
  page,
}) => {
  await openLibrary(page);

  const pending = await openEntry(page, 'C4Q01');
  await expect(
    pending.getByRole('region', { name: 'How to write the spoken answer' }),
  ).toBeVisible();
  const answer = pending.getByRole('textbox', { name: 'Spoken answer' });

  await answer.fill('ب'.repeat(481));
  await expect(
    pending.getByText(
      'Longer than 480 characters. Shorten it before marking it ready.',
    ),
  ).toBeVisible();
  // HeroUI hides a TextField's description while it is invalid; the counter must stay in view.
  await expect(
    pending.getByText('481 characters', { exact: true }),
  ).toBeVisible();
  await expect(pending.getByText('480', { exact: true })).toBeVisible();
  await expect(
    pending.getByRole('button', { name: 'Mark ready' }),
  ).toBeDisabled();

  await answer.fill(
    'سلام. کاشت مو در کلینیک ما انجام می‌شود. برای مشاوره تماس بگیرید.',
  );
  await pending.getByRole('button', { name: 'Mark ready' }).click();
  await expect(page.getByText('Marked ready for video.')).toBeVisible();
  await expect(pending.getByText('Ready for video')).toBeVisible();
  await expect(
    pending.getByRole('button', { name: 'Reopen text' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pending).toBeHidden();

  const draft = await openEntry(page, 'C4Q03');
  // The mock holds no media, so the review player shows its error with a retry.
  await expect(draft.getByText('The video could not be loaded.')).toBeVisible();
  await expect(draft.getByRole('button', { name: 'Retry' })).toBeVisible();
  await draft.getByRole('button', { name: 'Publish' }).click();

  await expect(page.getByText('Answer published.')).toBeVisible();
  await expect(draft.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  await expect(
    draft.getByRole('heading', { name: 'Answer C4Q03' }),
  ).toBeFocused();
});

test('withdraw needs the dialog, and Cancel changes nothing (REQ-033)', async ({
  page,
}) => {
  await openLibrary(page);
  const panel = await openEntry(page, 'C3Q01');

  await panel.getByRole('button', { name: 'Withdraw' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Withdraw' });
  await expect(dialog).toContainText('Users stop seeing it now.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('Published', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Withdraw' }).click();
  await dialog.getByRole('button', { name: 'Withdraw' }).click();

  await expect(page.getByText('Answer withdrawn.')).toBeVisible();
  await expect(panel.getByText('Withdrawn', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(1); // only Close is left
});

test('the list filters by status and by search', async ({ page }) => {
  await openLibrary(page);

  await page.getByRole('button', { name: /Status/ }).click();
  await page.getByRole('option', { name: 'Published' }).click();
  await expect(page.getByRole('row')).toHaveCount(3);

  await page.getByRole('searchbox').fill('C3Q02');
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('grid').getByText('C3Q02')).toBeVisible();
});

test('the library renders right to left in Persian', async ({ page }) => {
  await openLibrary(page);

  await page
    .getByRole('banner')
    .getByRole('button', { name: /Language/ })
    .click();
  await page.getByRole('option', { name: 'فارسی' }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page.getByRole('heading', { name: 'کتابخانه پاسخ‌ها', level: 1 }),
  ).toBeVisible();
  // The rows follow the language switch, not only the headers.
  await expect(
    page.getByRole('grid').getByText('در انتظار بررسی ویدیو'),
  ).toBeVisible();
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
});

test('a non-admin at /library gets the forbidden page (section 10)', async ({
  page,
}) => {
  await login(page, USER_PHONE);
  await expect(page).toHaveURL(/\/forbidden$/);

  await page.goto('/library');

  await expect(page).toHaveURL(/\/forbidden$/);
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
});
