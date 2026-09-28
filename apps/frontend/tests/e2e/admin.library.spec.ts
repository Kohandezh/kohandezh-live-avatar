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

/**
 * Moved from `web.contrast.spec.ts` with the workbench (REQ-037). The workbench once pinned itself
 * to light with `data-theme="light"` and painted white cards on a near-black page. Nothing on the
 * Record answer screen may be light enough to read as white in dark.
 */
test('dark: the Record answer screen follows the theme instead of pinning itself to light', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'settings',
      JSON.stringify({ language: 'en', theme: 'dark', reduceTransparency: 0 }),
    ),
  );
  await openLibrary(page);
  await page.getByRole('link', { name: 'Record answer' }).click();
  await page.getByRole('heading', { name: 'Text to speech' }).waitFor();

  await expect(page.locator('[data-theme="light"]')).toHaveCount(0);

  // Paints each colour on a canvas to resolve `oklch()` and `color-mix()`, then counts opaque
  // backgrounds whose luminance reads as white. Stringified, so it holds no closure values.
  const nearWhite = await page.evaluate(`(() => {
    function toRgba(input) {
      const key = String(input || '').trim();
      if (!key || key === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = key;
      ctx.fillRect(0, 0, 1, 1);
      const onBlack = ctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = key;
      ctx.fillRect(0, 0, 1, 1);
      const onWhite = ctx.getImageData(0, 0, 1, 1).data;
      let alpha = 0;
      for (let i = 0; i < 3; i += 1) alpha += 1 - (onWhite[i] - onBlack[i]) / 255;
      alpha = Math.min(1, Math.max(0, alpha / 3));
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return { r: onBlack[0] / alpha, g: onBlack[1] / alpha, b: onBlack[2] / alpha, a: alpha };
    }
    function luminance(c) {
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    }
    let count = 0;
    for (const el of document.querySelectorAll('main *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const own = toRgba(getComputedStyle(el).backgroundColor);
      if (own.a < 0.5) continue;
      if (luminance(own) > 0.7) count += 1;
    }
    return count;
  })()`);

  expect(nearWhite as number).toBe(0);
});
