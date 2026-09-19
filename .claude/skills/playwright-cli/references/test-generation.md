# Turning a CLI Session into a Spec File

`playwright-cli` prints Playwright **TypeScript** after every action, and the suite is
TypeScript, so the output transfers almost directly. Almost. The CLI output is a record of
what you did, not a spec you paste.

## Workflow

```bash
APP_TARGET=mobile VITE_API_MOCK=true \
  pnpm --filter @app/frontend exec vite --port 5273 &

playwright-cli open http://localhost:5273/login
playwright-cli snapshot
# snapshot shows: e1 [textbox "Phone number"], e2 [button "Send code"] ...

playwright-cli fill e1 "09351234567"
# Ran Playwright code:
# await page.getByLabel('Phone number').fill('09351234567');

playwright-cli click e2
# Ran Playwright code:
# await page.getByRole('button', { name: 'Send code' }).click();
```

Then assemble the spec by hand.

## What changes between CLI output and a spec

| CLI output | What the spec needs |
|---|---|
| `await page.goto('http://localhost:5273/login')` | `await page.goto('/login')`, because `baseURL` is set per project |
| a bare action | an `expect` after it: an action with no assertion proves nothing |
| `page.locator('.some-class')` | a role or label query, unless you are proving absence |
| an `eval` you used to look at state | an assertion on what the **user** sees |
| nothing | `test.beforeEach` for the setup every test in the file shares |

## The shape of a spec

```ts
import { expect, test } from '@playwright/test';

/** A seeded account. Read-only in every test here: nobody edits its name. */
const SEEDED_PHONE = '09351234567';
/** Fixed in the mock backend for every account (see src/data/mock/users.ts). */
const OTP_CODE = '123456';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
});

test('the OTP step appears after a phone number is submitted', async ({ page }) => {
  await page.getByLabel('Phone number').fill(SEEDED_PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(page.getByLabel('One-time code')).toBeVisible();
});
```

Four things the existing specs do, and you should too:

1. **Name the file for its project.** `mobile.login.spec.ts`, not `login.spec.ts`. A file
   that matches no `testMatch` pattern never runs.
2. **Name the test as a sentence about the behaviour**, and cite the requirement when the
   test came from one: `('the login screen has a title and a subtitle under it
   (requirements 7, 8)')`.
3. **Comment the non-obvious query.** The existing suite explains *why* a query is a link
   lookup rather than a text search, because a heading and a link can share a name. That
   comment is the difference between a test that guards something and a test that passes
   by accident.
4. **Assert absence with `toHaveCount(0)`**, never with a negated text search.

## Auto-waiting, and what it does not cover

`expect(locator).toBeVisible()` retries until the timeout, so almost no explicit wait is
needed. Do not add `page.waitForTimeout`. When you genuinely need to wait for state rather
than for an element, wait for the state:

```ts
await page.waitForURL('**/onboarding');
await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
```

## Driving a live avatar session

A conversation test needs the fake SDK, because `VITE_API_MOCK` only fakes our backend:

```ts
import { installFakeLiveAvatarSdk } from './utils/fakeLiveAvatarSdk';

test.beforeEach(async ({ page }) => {
  await installFakeLiveAvatarSdk(page);
});

test('the controls appear once the avatar starts speaking', async ({ page }) => {
  // ...reach the conversation screen...
  await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
  await expect(page.getByRole('button', { name: 'End' })).toBeVisible();
});
```

Read `tests/e2e/utils/fakeLiveAvatarSdk.ts` for the handle's full surface (`emit`,
`stopCount`, `isOpen`). `stopCount` is how you prove a route change really ended the call.

## Checklist

- File named `<project>.<topic>.spec.ts`.
- Paths are relative, so `baseURL` picks the port.
- Every action is followed by an assertion.
- Queries are role or label based, with a comment where the choice is not obvious.
- The test fails when the fix is reverted. Check that, do not assume it.
