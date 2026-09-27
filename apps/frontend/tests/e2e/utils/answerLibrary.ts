import { expect, type Page } from '@playwright/test';
import en from '../../../src/i18n/locales/en/common.json' with { type: 'json' };
import fa from '../../../src/i18n/locales/fa/common.json' with { type: 'json' };

/** "User Example": has a name in the mock seed, so login skips onboarding. */
const SEEDED_PHONE = '09351234567';
/** `MOCK_OTP_CODE` in src/data/mock/users.ts. */
const OTP_CODE = '123456';

/**
 * The Persian strings the specs read, copied from the app's own locale file, never typed from
 * memory.
 */
export { fa };

/**
 * The two published answers of the mock seed (src/data/mock/handlers.ts), in list order. The mock
 * library is Persian only, like the rendered library, so the playback flows run in Persian.
 */
export const FIRST_QUESTION = 'دکتر کهندژ کیست و چه کاری انجام می‌دهد؟';
export const SECOND_QUESTION = 'برای کاشت مو چند گرافت لازم دارم؟';
export const FIRST_ANSWER =
  'دکتر کهندژ متخصص کاشت مو است و سال‌هاست در این زمینه کار می‌کند.';

/**
 * Logs the seeded user in and lands on `/video`, in `language` (chosen on the login screen).
 * `onLoginPage`: the page is already on `/login`. Set it after changing the mock there: a new
 * `goto` reloads the page, and the in-page mock starts again from its seed.
 */
export async function loginToVideo(
  page: Page,
  {
    language = 'fa',
    onLoginPage = false,
  }: { language?: 'en' | 'fa'; onLoginPage?: boolean } = {},
): Promise<void> {
  if (!onLoginPage) await page.goto('/login');
  if (language === 'fa') {
    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('option', { name: 'فارسی' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  }
  const text = language === 'fa' ? fa : en;
  await page.getByLabel(text.auth.phone).fill(SEEDED_PHONE);
  await page.getByRole('button', { name: text.auth.sendCode }).click();
  await page.getByLabel(text.auth.code).fill(OTP_CODE);
  await page.waitForURL('**/video');
}

export function suggestionList(page: Page, name: string = fa.library.suggestionsTitle) {
  return page.getByRole('list', { name });
}

/**
 * Changes the mock library the way an admin elsewhere would: through the mock's own admin routes,
 * inside the page. The mock lives in the browser (an axios adapter), so there is no network
 * request to intercept.
 *
 * The request goes straight to the mock adapter with no `Authorization` header, as the admin's
 * session. Not through the app's client: after login it carries the user's bearer token, which
 * the mock trusts before its session.
 *
 * The module is imported by the exact URL the app loaded it from. Vite serves this app's source
 * under `/@fs/<absolute path>`, because each target's root is `src/app/<target>`, and the same URL
 * gives the same module instance, so the change reaches the running app.
 */
export async function patchAsAdmin(
  page: Page,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Right after a `goto`, the app's bootstrap may still be importing the mock.
  await page.waitForFunction(() =>
    performance
      .getEntriesByType('resource')
      .some(
        (entry) =>
          entry.name.includes('/@fs/') && entry.name.endsWith('/src/data/mock/index.ts'),
      ),
  );
  await page.evaluate(
    async ({ path, body }) => {
      const url = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find(
          (candidate) =>
            candidate.includes('/@fs/') && candidate.endsWith('/src/data/mock/index.ts'),
        );
      if (!url) throw new Error('The app has not loaded the mock API');
      const mock = (await import(url)) as {
        mockSession: {
          get: () => string | null;
          set: (userId: string) => void;
          clear: () => void;
        };
        createMockAdapter: (options: { delayMs: number }) => (config: {
          url: string;
          method: string;
          data: string;
          headers: Record<string, string>;
        }) => Promise<unknown>;
      };
      const user = mock.mockSession.get();
      mock.mockSession.set('u-admin');
      try {
        await mock.createMockAdapter({ delayMs: 0 })({
          url: path,
          method: 'patch',
          data: JSON.stringify(body),
          headers: {},
        });
      } finally {
        // Back to whoever was signed in, or to nobody before a login.
        if (user) mock.mockSession.set(user);
        else mock.mockSession.clear();
      }
    },
    { path, body },
  );
}

/** The recorded answer's element, once it holds the downloaded file. */
export function recordedVideo(page: Page) {
  return page.locator('video[src^="blob:"]');
}

/**
 * Proves the real MP4 is playing: not paused, and time has passed. 15 s, not the default 5: with
 * every project running in parallel, a headless browser can take several seconds to start a
 * media pipeline.
 */
export async function expectRecordedAnswerPlaying(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        recordedVideo(page).evaluate(
          (video: HTMLVideoElement) => !video.paused && video.currentTime > 0,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** Every `src` on the page. None may point at the API (ADR 0014 item 6). */
export async function allSources(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[src]')).map(
      (element) => element.getAttribute('src') ?? '',
    ),
  );
}
