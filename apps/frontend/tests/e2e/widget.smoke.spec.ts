import { expect, test } from '@playwright/test';
import fa from '../../src/i18n/locales/fa/common.json' with { type: 'json' };

// The demo page loads the widget with data-lang="fa", so the UI starts in Persian.
// Playwright locators reach into the Shadow DOM, so no extra handle is needed.

test('the launcher opens the assistant panel', async ({ page }) => {
  await page.goto('/');

  const launcher = page.getByRole('button', { name: 'گفتگو با دکتر کهن‌دژ' });
  await expect(launcher).toBeVisible();

  await launcher.click();

  const panel = page.getByRole('dialog', { name: 'دستیار دکتر کهن‌دژ' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'شروع گفتگو' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('the panel switches to English', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'گفتگو با دکتر کهن‌دژ' }).click();
  await page.getByRole('button', { name: 'English' }).click();

  await expect(page.getByRole('dialog', { name: 'Dr. Kohandezh Assistant' })).toBeVisible();
});

test('the widget loads no answer library code and asks for no library route (REQ-064, SC-018)', async ({ page }) => {
  const libraryRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/library')) libraryRequests.push(request.url());
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'گفتگو با دکتر کهن‌دژ' }).click();
  await expect(page.getByRole('dialog', { name: 'دستیار دکتر کهن‌دژ' })).toBeVisible();

  // The dev mock answers inside the page, so no request would show on the network. What the page
  // loaded is the stronger proof: without the library's modules, nothing can call its routes.
  const libraryModules = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/library-entry/') || name.includes('/answer-library/')),
  );
  expect(libraryModules).toEqual([]);
  expect(libraryRequests).toEqual([]);
  // No lead card and no contact links in the widget (REQ-075).
  await expect(page.getByRole('region', { name: fa.library.lead.title })).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0);
});
