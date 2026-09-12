import { expect, test } from '@playwright/test';

/**
 * The sphere must repaint when the THEME changes, not only when it is resized.
 *
 * Its colours live in CSS custom properties and in the theme palette, and a theme switch changes
 * both while the canvas keeps the exact same size. Reading the colours only on resize would leave
 * the sphere in the old theme's palette forever, because nothing on this screen ever resizes it.
 *
 * The idle screen is the honest case to test: the status is not `connected`, so there is no
 * animation frame loop running to accidentally cover the bug with the next frame. One still frame
 * is all there is.
 */
test('the sphere repaints when the theme changes, with no resize', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.waitForURL('**/video');
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: 'Audio' })
    .click();
  await page.waitForURL('**/audio');
  await expect(page.locator('[data-sphere-state="idle"]')).toBeVisible();

  const sample = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const pixel = ctx.getImageData(
        Math.round(canvas.width / 2),
        Math.round(canvas.height / 2),
        1,
        1,
      ).data;
      return {
        size: `${canvas.width}x${canvas.height}`,
        rgb: [pixel[0], pixel[1], pixel[2]] as [number, number, number],
      };
    });

  const before = await sample();

  // Flip the marker `ThemeSync` writes. This is the only signal the sphere watches.
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'dark';
  });
  // The MutationObserver fires on a microtask; one animation frame is plenty.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );

  const after = await sample();

  // Same canvas, so nothing resized it.
  expect(after.size).toBe(before.size);

  /*
    The dark core is a near-white hot centre (lightness 0.97); the light core's centre is a
    mid-violet lamp well below the page's lightness. Any real repaint moves the middle pixel a
    long way. A stale palette would move it by almost nothing, because the only other thing that
    changes between the two frames is the idle "breath", which is worth about two percent of the
    radius.
  */
  const moved = Math.max(
    ...after.rgb.map((value, index) => Math.abs(value - before.rgb[index])),
  );
  expect(moved, `${before.rgb} -> ${after.rgb}`).toBeGreaterThan(20);
});
