---
name: e2e-test-gen
description: Generate a browser test for one of the four targets by exercising the running app with playwright-cli first, then assembling the result into a TypeScript spec under apps/frontend/tests/e2e/. The file name picks the Playwright project, so a badly named spec silently never runs.
allowed-tools: Bash(playwright-cli:*) Bash(pnpm:*) Bash(npx:*) Edit Write Read Grep Glob
---

# Browser test generation

When asked to generate a browser test for a flow ("write an e2e test for login", "test
what happens when the user switches language mid-call"), follow this workflow. Explore the
real app first. Do not write the spec from reading the source.

The CLI reference, the project layout, and the repo's e2e patterns live in the
`playwright-cli` skill. This skill is the **procedure**.

## Step 0: decide it belongs here

An e2e test is the most expensive test in the repo. It starts four dev servers and a real
browser. Use it only for a **user flow inside a target**.

- A pure function, a schema, a reducer → `tests/unit/`, Vitest. See `write-tests`.
- A page, a guard, a hook with providers → `tests/integration/`, Vitest.
- A flow across screens, or anything that needs a real browser (media, Shadow DOM,
  computed styles, the service worker) → here.

If an integration test can prove it, write that instead.

## Step 1: pick the target, and name the file for it

`testMatch` in `playwright.config.ts` picks the project from the file name. **A file that
matches no pattern is collected by no project and silently never runs.**

| Flow lives in | File name | Port | Device |
| ------------- | --------- | ---- | ------ |
| the mobile app | `mobile.<topic>.spec.ts` | 5273 | Pixel 7 |
| the web PWA | `web.<topic>.spec.ts` | 5274 | Desktop Chrome |
| the admin dashboard | `admin.<topic>.spec.ts` | 5275 | Desktop Chrome |
| the website widget | `widget.<topic>.spec.ts` | 5276 | Desktop Chrome |

A shared screen (`pages/login`, `pages/settings`) reaches both `mobile` and `web`. Decide
which one the behaviour actually belongs to; do not write the same spec twice.

## Step 2: explore the running app

Start the target with the mock API on, the same way the suite does:

```bash
APP_TARGET=mobile VITE_API_MOCK=true \
  pnpm --filter @app/frontend exec vite --port 5273 &

playwright-cli open http://localhost:5273/login
playwright-cli snapshot
```

Facts you will need:

- The seeded account is `09351234567` and the one-time code is always `123456`
  (`src/data/mock/users.ts`).
- A fresh account lands on `/onboarding`, not on the home screen: `RequireProfile` gates
  the product screens on a name being on file.
- The default language is English. Persian is a runtime switch and flips `<html dir>`.

Walk the flow by hand, one command at a time, reading the snapshot after each. The CLI
prints the Playwright TypeScript it ran; keep that output, it is most of the spec.

For a flow that reaches a connected conversation you need the fake SDK, which the CLI
cannot install. Explore up to the point of connection with the CLI, then write the rest of
the spec using `installFakeLiveAvatarSdk` and check it with a real run.

## Step 3: write down what the test is actually guarding

Before assembling the file, say in one sentence what would break if this test were
deleted. That sentence becomes the test name.

Good: `'the OTP step renders six separate slots, not one text box'`
Bad: `'login works'`

Cite the requirement number when the test came from a spec or a ticket:
`'the login screen has a title and a subtitle under it (requirements 7, 8)'`. The existing
suite does this, and it is how a reader knows which behaviour is deliberate.

## Step 4: assemble the spec

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

Rules the existing suite follows:

1. **Relative paths.** `page.goto('/login')`. `baseURL` comes from the project.
2. **Role and label queries.** There is no `data-testid` in app code, and adding one to
   make a test easier is the wrong fix: if the test cannot find the button by its
   accessible name, neither can a screen reader.
3. **Every action is followed by an assertion.** An action with no assertion proves
   nothing.
4. **Prove absence with `toHaveCount(0)`**, never with a negated text search. A heading and
   a link can share a name.
5. **Comment a query whose form is not obvious**, and say why. That comment is what stops
   the next person from "simplifying" the test into one that passes by accident.
6. **No `page.waitForTimeout`.** Assertions retry. Wait for state (`waitForURL`), not for
   the clock.

## Step 5: cover the states, not just the happy path

A flow test that only walks the success path is half a test. Add the ones that apply:

- **error**: force it with `page.route` and a real error body. The orchestrator's shape is
  `{ "error": { code, message, retryable, details }, "correlation_id" }`.
- **empty**: an empty list shows `EmptyState`, not a blank screen.
- **offline**: `route.abort('internetdisconnected')`, then look for `OfflineBanner`.
- **401 / 403**: an anonymous user is redirected to `/login`; a disabled account reaches
  `/forbidden`.
- **RTL**: switch to Persian and assert `<html dir="rtl">`, plus that the layout still
  holds. Do not hard-code Persian strings from memory; read them from
  `src/i18n/locales/fa/common.json`.

`.claude/skills/playwright-cli/references/request-mocking.md` has the stubs.

## Step 6: prove it fails without the fix

Run it:

```bash
pnpm --filter @app/frontend exec playwright test tests/e2e/mobile.login.spec.ts
```

Then **revert the change the test is meant to guard and run it again.** A test that passes
either way is not a test. Do this, do not assume it.

If it passes instantly and suspiciously, check the file name first: a spec that matches no
project is never collected, and "0 tests ran" reads a lot like success.

Finally:

```bash
pnpm test:e2e
```

## Step 7: report

Say which project the spec runs under, what it guards, which states it covers, and that
you confirmed it fails without the change.

## Checklist

- File named `<project>.<topic>.spec.ts`, so a project collects it.
- Explored in a real browser first, not written from the source.
- Test name states the behaviour, and cites the requirement when there is one.
- Role and label queries, no new `data-testid` in app code.
- Every action followed by an assertion; no `waitForTimeout`.
- The non-happy states are covered, not only success.
- Verified to fail when the change is reverted.
- `pnpm test:e2e` passes.
