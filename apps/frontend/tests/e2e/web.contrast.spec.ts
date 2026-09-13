import { expect, test, type Page } from '@playwright/test';

/**
 * Guards the theme contrast fixes.
 *
 * Every number here was a real defect once: cards and inputs with no edge in
 * dark, a danger button and an accent hover state whose white label was too
 * pale, red error text that went unreadable on a dark card, and muted text on
 * the light page ground. The tokens live in one file, `src/styles/globals.css`,
 * so one careless change can take all of them back out at once. These tests
 * read the colours the browser actually paints and check them against the WCAG
 * floors: 4.5:1 for body text, 3:1 for a control boundary.
 */

/** A seeded account. Already has a name, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

/** WCAG 1.4.3, normal-size text. */
const TEXT_FLOOR = 4.5;
/** WCAG 1.4.11, the boundary of a user interface component. */
const BOUNDARY_FLOOR = 3;

type Theme = 'light' | 'dark';

/**
 * Runs in the page. Resolves any CSS colour (`oklch()` and `color-mix()`
 * included, which no string parser handles) by painting it on a canvas, then
 * returns WCAG contrast between two elements' colours.
 *
 * Stringified by Playwright, so it can hold no imports and no closure values.
 */
const CONTRAST_HELPERS = `
  function toRgba(input) {
    const key = String(input || '').trim();
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    if (!key || key === 'transparent' || key === 'none') return clear;
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
    if (alpha === 0) return clear;
    return { r: onBlack[0] / alpha, g: onBlack[1] / alpha, b: onBlack[2] / alpha, a: alpha };
  }
  function over(top, bottom) {
    return {
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    };
  }
  function luminance(c) {
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }
  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** The opaque colour actually behind an element, after every translucent layer. */
  function groundOf(el) {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const bg = toRgba(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 0.999) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
    return base;
  }
`;

/** Contrast of an element's text against what is painted behind it. */
async function textContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    `(() => {
      ${CONTRAST_HELPERS}
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('not found: ' + ${JSON.stringify(selector)});
      const ground = groundOf(el);
      return contrast(over(toRgba(getComputedStyle(el).color), ground), ground);
    })()`,
  ) as Promise<number>;
}

/** Contrast of an element's own border against its own fill. */
async function borderContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    `(() => {
      ${CONTRAST_HELPERS}
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('not found: ' + ${JSON.stringify(selector)});
      const style = getComputedStyle(el);
      if (parseFloat(style.borderTopWidth) === 0) return 1;
      const fill = over(toRgba(style.backgroundColor), groundOf(el.parentElement));
      return contrast(over(toRgba(style.borderTopColor), fill), fill);
    })()`,
  ) as Promise<number>;
}

/**
 * Buttons and fields fade their background over 150ms. `getComputedStyle`
 * reads the value mid-fade, so without this wait a hover measurement is really
 * a measurement of the rest state on its way there.
 */
async function settle(page: Page) {
  await page.waitForTimeout(400);
}

/** Picks the theme before the app boots, the way a returning user would have it saved. */
async function useTheme(page: Page, theme: Theme) {
  await page.addInitScript(
    (saved: string) => window.localStorage.setItem('settings', saved),
    JSON.stringify({
      language: 'en',
      theme,
      reduceTransparency: 0,
      micPermissionAsked: true,
    }),
  );
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
  await expect(page).toHaveURL(/\/video$/);
}

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`${theme}: a resting text input has a visible boundary`, async ({ page }) => {
    await useTheme(page, theme);
    await login(page);
    await page.goto('/settings/personal');
    await page.getByLabel('First name').waitFor();
    // Park the pointer away from the field: hover has its own, stronger border.
    await page.mouse.move(5, 5);
    await settle(page);

    expect(await borderContrast(page, 'input[type="text"]')).toBeGreaterThanOrEqual(
      BOUNDARY_FLOOR,
    );
  });

  test(`${theme}: the danger button label is readable at rest and on hover`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await login(page);
    await page.goto('/settings/personal');
    const logOut = page.getByRole('button', { name: 'Log out' });
    await logOut.waitFor();

    await page.mouse.move(5, 5);
    await settle(page);
    expect(await textContrast(page, '.button--danger')).toBeGreaterThanOrEqual(TEXT_FLOOR);

    await logOut.hover();
    await settle(page);
    expect(await textContrast(page, '.button--danger')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  test(`${theme}: the accent button label is readable at rest and on hover`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await page.goto('/login');
    const sendCode = page.getByRole('button', { name: 'Send code' });
    await sendCode.waitFor();

    await page.mouse.move(5, 5);
    await settle(page);
    expect(await textContrast(page, '.button--primary')).toBeGreaterThanOrEqual(TEXT_FLOOR);

    // Hover used to move the fill towards its own white label, which is why
    // the accent needs an explicit `--accent-hover` rather than HeroUI's.
    await sendCode.hover();
    await settle(page);
    expect(await textContrast(page, '.button--primary')).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  test(`${theme}: a form error reads on the card it sits on`, async ({ page }) => {
    await useTheme(page, theme);
    await login(page);
    // A card, not the login page: a card is the harder ground in dark, because
    // red text there has less room than it has on the near-black page.
    await page.goto('/settings/personal');
    await page.getByLabel('First name').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Enter your first name.').waitFor();
    await page.mouse.move(5, 5);
    await settle(page);

    expect(await textContrast(page, '.field-error')).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(
      await textContrast(
        page,
        '.label--invalid, [data-invalid="true"] .label, [aria-invalid="true"] .label',
      ),
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
}

test('light: muted text reads on the page ground, not only on a card', async ({ page }) => {
  await useTheme(page, 'light');
  await page.goto('/login');
  await page.getByLabel('Phone number').waitFor();

  // The subtitle under the login title sits straight on the page background,
  // which is where `--muted` used to fall just under the floor.
  expect(await textContrast(page, '.text-muted')).toBeGreaterThanOrEqual(TEXT_FLOOR);
});

test('dark: every card has an edge against the page behind it', async ({ page }) => {
  await useTheme(page, 'dark');
  await login(page);
  await page.goto('/settings/personal');
  await page.locator('[data-slot="card"]').first().waitFor();

  const worst = await page.evaluate(
    `(() => {
      ${CONTRAST_HELPERS}
      let worst = Infinity;
      for (const card of document.querySelectorAll('[data-slot="card"]')) {
        // The edge is the first, 1px layer of --surface-shadow. Read the token
        // rather than the shadow string, which the browser serialises as one blob.
        const edge = getComputedStyle(card).getPropertyValue('--surface-edge').trim();
        const behind = groundOf(card.parentElement);
        worst = Math.min(worst, contrast(over(toRgba(edge), behind), behind));
      }
      return worst;
    })()`,
  );

  expect(worst as number).toBeGreaterThanOrEqual(BOUNDARY_FLOOR);
});

test('dark: the avatar workbench follows the theme instead of pinning itself to light', async ({
  page,
}) => {
  await useTheme(page, 'dark');
  await page.goto('/avatar');
  await page.getByRole('heading', { name: 'Text to speech' }).waitFor();

  // It used to carry data-theme="light" and paint four white cards on a
  // near-black page. Nothing on it may be light enough to read as white.
  await expect(page.locator('[data-theme="light"]')).toHaveCount(0);

  const nearWhite = await page.evaluate(
    `(() => {
      ${CONTRAST_HELPERS}
      let count = 0;
      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const own = toRgba(getComputedStyle(el).backgroundColor);
        if (own.a < 0.5) continue;
        if (luminance(over(own, groundOf(el.parentElement))) > 0.7) count += 1;
      }
      return count;
    })()`,
  );

  expect(nearWhite as number).toBe(0);
});
