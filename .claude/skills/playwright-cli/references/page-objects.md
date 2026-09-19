# E2E Patterns in This Repo

There is no Page Object Model here, and no `data-testid` in app code. Do not build either.
This file documents the patterns the existing specs use.

Working examples to copy from (`apps/frontend/tests/e2e/`):

- `mobile.login.spec.ts` — role and label queries, proving absence
- `mobile.conversation.spec.ts` — a live avatar session end to end
- `mobile.orb.spec.ts` — driving provider events
- `widget.smoke.spec.ts` — the Shadow DOM target
- `web.contrast.spec.ts` — a computed-style assertion

## The shape

Everything lives in the spec file. There is no e2e `conftest`-style shared fixture layer,
and `@playwright/test` gives you `page`, `context` and `browser` already. The only shared
helper is `tests/e2e/utils/fakeLiveAvatarSdk.ts`.

```ts
import { expect, test } from '@playwright/test';

/** A seeded account. Read-only in every test here: nobody edits its name. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
});
```

Paths are relative. `baseURL` comes from the project, so the same spec text would work on
any port.

## 1. Logging in

There is no shared login fixture. Each spec that needs a session walks the flow, because
the flow is short and the mock code is fixed:

```ts
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill(OTP_CODE);
}
```

If a spec logs in more than twice, lift that helper to the top of the file. Do not lift it
to a shared module until a second file needs it.

The account's onboarding state matters: `RequireProfile` gates the product screens on a
name being on file, so a fresh account lands on `/onboarding`, not on the home screen.

## 2. The fake avatar SDK

`VITE_API_MOCK=true` fakes our backend. It does not fake the provider. Any test that
reaches a connected conversation needs the fake SDK:

```ts
import { installFakeLiveAvatarSdk } from './utils/fakeLiveAvatarSdk';

test.beforeEach(async ({ page }) => {
  await installFakeLiveAvatarSdk(page);
});
```

It intercepts the one dynamic `import()` of `@heygen/liveavatar-web-sdk` that Vite serves,
so no product code changes. The page then gets `window.__liveAvatar`:

| Member | What it is |
| ------ | ---------- |
| `emit(event, payload?)` | fires one provider event at every subscribed handler |
| `stopCount` | how many sessions were stopped, which proves a route change ended the call |
| `isOpen` | whether a session is currently open |

```ts
await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
await expect
  .poll(() => page.evaluate(() => window.__liveAvatar.stopCount))
  .toBe(1);
```

**The handle appears only after the hook has loaded the SDK.** For a few hundred
milliseconds after navigation `window.__liveAvatar` is still `undefined`. Wait for the UI
state that proves the session connected before you call `emit`, rather than emitting
immediately and hoping.

Its event names, payload shapes and enum values are copied from
`tests/utils/liveAvatarSdkMock.ts`, which the Vitest suite drives the same hook with.
**Change one, change both.**

## 3. Queries

In order of preference:

```ts
page.getByRole('heading', { level: 1 })
page.getByRole('button', { name: 'Send code' })
page.getByLabel('Phone number')
page.getByText('Enter your phone number to talk to Dr. Kohandezh.')
page.locator('nav')                       // for proving absence
```

Two rules the existing suite follows and you should copy:

- **Prove absence with `toHaveCount(0)`**, never with a negated text search. A heading and
  a link can share an accessible name, so only a role-scoped query proves the old header
  link is gone.
- **Comment a query whose form is not obvious.** Say why it is a link lookup rather than a
  text search. That comment is what stops the next person from "simplifying" the test into
  one that passes by accident.

## 4. The microphone

`mobile` and `web` launch Chromium with `--use-fake-ui-for-media-stream` and
`--use-fake-device-for-media-stream`, so a real `getUserMedia` resolves with nobody at the
keyboard to accept the native dialog. You do not need to stub it.

The onboarding microphone step remembers that it asked (`micPermissionAsked` in the
settings slice, persisted to `localStorage`), so a test that depends on being asked must
start from a clean storage state. A fresh `context` per test gives that by default.

## 5. The widget target

`widget.*.spec.ts` runs against `src/app/widget/index.html`, a stand-in customer page. The
widget renders inside a **Shadow DOM**. Playwright's locators pierce open shadow roots, so
`getByRole` works, but anything that reaches for `document.querySelector` from `evaluate`
will not find the content. Use locators.

The widget has no router and no Redux, so there is no navigation to assert on and no theme
sync. A rule that keys off `html.dark` does not reach inside that shadow root.

## 6. Language and RTL

The language control is on the login screen itself; an anonymous visitor has no header or
nav to hold it. `LanguageSync` writes `lang` and `dir` on `<html>`.

```ts
await page.getByLabel('Language').click();
// ...choose Persian...
await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
```

Do not hard-code Persian strings you typed from memory. Read them from
`src/i18n/locales/fa/common.json`, or keep the assertion structural.

## What not to do

- No `page.waitForTimeout`. Assertions retry; wait for state, not for the clock.
- No Page Object classes. The specs are short and the indirection costs more than it saves.
- No `data-testid` added to app code to make a test easier. Fix the accessible name instead:
  if the test cannot find the button by its name, neither can a screen reader.
- No shared mutable account state between specs. `fullyParallel` is on.
