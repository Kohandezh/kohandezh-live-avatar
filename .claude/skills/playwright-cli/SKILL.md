---
name: playwright-cli
description: Drive a real browser against this app with playwright-cli, then write the regression test in TypeScript. Covers the four Playwright projects (mobile, web, admin, widget), tests/e2e/, the mock API the suite runs against, and the CLI reference (selectors, mocking, storage, tracing, video).
allowed-tools: Bash(playwright-cli:*) Bash(pnpm:*) Bash(npx:*)
---

# Browser automation and browser tests

Two different things. Keep them apart.

- **`playwright-cli`** is an interactive tool for exploring the app in a browser right
  now. You type commands, it acts and prints a snapshot. Nothing is committed.
- **A browser test** is TypeScript, lives in `apps/frontend/tests/e2e/`, and runs in CI.

You explore with the CLI, then you write the test. The CLI prints TypeScript, and the
suite is TypeScript, so the generated code transfers almost directly.
`references/test-generation.md` covers the gap.

## Repo facts

| | |
|---|---|
| Language | TypeScript. `@playwright/test`, config at `apps/frontend/playwright.config.ts` |
| Tests live in | `apps/frontend/tests/e2e/`, named `<target>.<topic>.spec.ts` |
| Run the suite | `pnpm test:e2e` (from the repository root) |
| Run one file | `pnpm --filter @app/frontend exec playwright test tests/e2e/mobile.login.spec.ts` |
| Browser binary | `pnpm --filter @app/frontend exec playwright install` (once) |
| Projects | `mobile` (Pixel 7), `web` (Desktop Chrome), `admin`, `widget` |
| Backend | none. The suite runs against `VITE_API_MOCK=true` |
| Language | English by default. Persian (`fa`) is a runtime switch, and `<html dir>` flips |
| Test IDs | none in app code. Use role + accessible name |
| Gate | CI on GitHub, the `e2e` job |

### Four targets, four servers, four ports

Playwright starts its **own** dev servers on ports 5273 to 5276, deliberately not the
`pnpm dev` ports. The dev ports belong to whoever ran `pnpm dev`, and those servers
usually talk to the real backend. With `reuseExistingServer` on, Playwright would attach
to one of those and every login test would wait forever for an SMS that the mock was
meant to provide.

| Project  | Port | File pattern            | Device         |
| -------- | ---- | ----------------------- | -------------- |
| `mobile` | 5273 | `mobile.*.spec.ts`      | Pixel 7        |
| `web`    | 5274 | `web.*.spec.ts`         | Desktop Chrome |
| `admin`  | 5275 | `admin.*.spec.ts`       | Desktop Chrome |
| `widget` | 5276 | `widget.*.spec.ts`      | Desktop Chrome |

**The file name picks the project.** A spec named `login.spec.ts` matches nothing and
never runs. Name it `mobile.login.spec.ts`.

`mobile` and `web` launch Chromium with `--use-fake-ui-for-media-stream` and
`--use-fake-device-for-media-stream`, so a real `getUserMedia` call resolves with nobody
at the keyboard to accept the native permission dialog.

### The mock backend and the fake SDK

`VITE_API_MOCK=true` fakes **our** backend only (`src/data/mock`). A seeded account is
`09351234567` and the one-time code is always `123456` (`src/data/mock/users.ts`).

It does **not** fake the avatar provider. The real `@heygen/liveavatar-web-sdk` would
still run in the browser and get nowhere with a fake token, which used to leave every
mid-call state untestable. `tests/e2e/utils/fakeLiveAvatarSdk.ts` intercepts the one
dynamic `import()` Vite serves and swaps the whole SDK, then exposes
`window.__liveAvatar` so a test can drive a live session:

```ts
await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
```

Its event names and payloads are copied from `tests/utils/liveAvatarSdkMock.ts`, which
the Vitest suite drives the same hook with. **Keep the two in step.**

## Quick start with the CLI

Start the target you care about from `.claude/launch.json`, or by hand:

```bash
APP_TARGET=mobile VITE_API_MOCK=true \
  pnpm --filter @app/frontend exec vite --port 5273 &

playwright-cli open http://localhost:5273
playwright-cli snapshot
playwright-cli click e15                              # refs come from the snapshot
playwright-cli close
```

After each command the CLI prints a snapshot of the browser state. Use the refs (`e15`)
from that snapshot to target elements.

`playwright-cli` is a standalone binary. If it is missing, install it with
`npm install -g @playwright/cli@latest`. It is a developer tool only. Never add it to a
`package.json` in this repo.

## Command reference

Run `playwright-cli <command> --help` for full options.

**Core interaction**

```bash
playwright-cli open [url]                # also: --browser=chrome|firefox|webkit|msedge,
                                         #       --persistent, --profile=DIR, --config=FILE
playwright-cli goto <url>
playwright-cli click|dblclick|hover <ref>
playwright-cli fill <ref> <text> [--submit]
playwright-cli type <text>
playwright-cli select <ref> <value>
playwright-cli check|uncheck <ref>
playwright-cli drag <ref> <ref>
playwright-cli drop <ref> --path=FILE | --data="mime=value"
playwright-cli upload <file>
playwright-cli eval "<js>" [ref]         # read attributes/text not in the snapshot
playwright-cli dialog-accept ["text"] | dialog-dismiss
playwright-cli resize <w> <h>
playwright-cli close | close-all | kill-all
```

**Navigation and input**

```bash
playwright-cli go-back | go-forward | reload
playwright-cli press <Key> | keydown <Key> | keyup <Key>
playwright-cli mousemove <x> <y> | mousedown [right] | mouseup [right] | mousewheel <x> <y>
```

**Capture**

```bash
playwright-cli snapshot [target] [--filename=F] [--depth=N] [--boxes]
playwright-cli screenshot [ref] [--filename=F]
playwright-cli pdf --filename=F
```

**Tabs**

```bash
playwright-cli tab-list | tab-new [url] | tab-close [index] | tab-select <index>
```

**Storage, network, devtools**

```bash
playwright-cli state-save|state-load [file]                  # -> storage-state.md
playwright-cli cookie-* / localstorage-* / sessionstorage-*  # -> storage-state.md
playwright-cli route|unroute|route-list                      # -> request-mocking.md
playwright-cli console [level] | network                     # devtools logs
playwright-cli run-code "<js>" | --filename=F                # -> running-code.md
playwright-cli tracing-start|tracing-stop                    # -> tracing.md
playwright-cli video-start|video-chapter|video-stop          # -> video-recording.md
playwright-cli show --annotate                               # ask the user via the dashboard
playwright-cli generate-locator <ref> [--raw]
playwright-cli highlight <ref> [--style=...] [--hide]
playwright-cli attach --extension=chrome | --cdp=chrome|URL  # -> session-management.md
```

`eval` and `run-code` take **JavaScript**, because they run inside the CLI's own driver
process. Your spec file is TypeScript, so most of it transfers directly.

## Raw and JSON output

`--raw` strips the status, generated code and snapshot sections and returns only the
result value, which makes it pipeable. `--json` wraps every reply as JSON.

```bash
playwright-cli --raw eval "document.documentElement.lang"
playwright-cli --raw snapshot > before.yml
playwright-cli click e5
playwright-cli --raw snapshot > after.yml && diff before.yml after.yml
SESSION=$(playwright-cli --raw cookie-get kd_session)
```

## Targeting elements in this app

Prefer refs from the snapshot. CSS selectors and Playwright locators also work.

App code has **no `data-testid` attributes**, so `getByTestId` will find nothing outside a
couple of Vitest fixtures. What to use instead, in order of preference:

1. **A role plus an accessible name.** This is the house style, and the whole e2e suite is
   written this way:
   `getByRole('heading', { level: 1 })`, `getByRole('button', { name: 'Send code' })`,
   `getByRole('link', { name: 'Log in', exact: true })`.
2. **A label.** `getByLabel('Phone number')`, `getByLabel('One-time code')`,
   `getByLabel('Language')`. HeroUI is built on React Aria, so controls carry real labels.
3. **Visible text**, for copy whose presence is the point: `getByText('Enter your phone
   number to talk to Dr. Kohandezh.')`.
4. **A structural locator** (`page.locator('nav')`, `page.locator('header')`). Useful for
   proving something is *absent*, which a text query cannot do reliably.

```bash
playwright-cli click e15
playwright-cli click "getByRole('button', { name: 'Send code' })"
playwright-cli click "getByLabel('Phone number')"
```

Assert absence with `toHaveCount(0)`, not with a negated text search. A heading and a link
can share a name, so `getByRole('link', { name: 'Log in' })` is the query that proves the
old header link is gone; a text search would still pass.

Never assert on Persian text you typed from memory. Copy it out of
`src/i18n/locales/fa/common.json`, or switch the test to English.

## Named sessions

Run several isolated browsers at once with `-s=<name>` (details in
`references/session-management.md`):

```bash
playwright-cli -s=visitor open http://localhost:5273
playwright-cli -s=admin   open http://localhost:5275
playwright-cli list
playwright-cli close-all
```

Useful when a behaviour depends on two parties, or on comparing two targets of the same
screen side by side.

## Example: walk the login flow

```bash
APP_TARGET=mobile VITE_API_MOCK=true \
  pnpm --filter @app/frontend exec vite --port 5273 &

playwright-cli open http://localhost:5273/login
playwright-cli snapshot
playwright-cli fill "getByLabel('Phone number')" "09351234567"
playwright-cli click "getByRole('button', { name: 'Send code' })"
playwright-cli snapshot
playwright-cli fill "getByLabel('One-time code')" "123456"
playwright-cli --raw eval "document.documentElement.dir"
playwright-cli close
```

## Checking RTL

The language control is on the login screen itself, and `LanguageSync` writes `lang` and
`dir` on `<html>`. Switch and read it back:

```bash
playwright-cli click "getByLabel('Language')"
playwright-cli --raw eval "document.documentElement.dir"      # expect: rtl
playwright-cli screenshot --filename=/tmp/fa-login.png
```

Persian strings are longer, so look at the screenshot, not only at the DOM.

## After you find the bug

Reproducing it in the CLI is half the job. The other half is a test that fails without the
fix and passes with it, in `apps/frontend/tests/e2e/`, named for the right project. Then:

```bash
pnpm test:e2e
gh run list --branch <branch> --limit 1
gh run watch
```

On a red `e2e` job in CI, download the report instead of guessing:

```bash
gh run download <run-id> -n playwright-report
```

## Specific tasks

- **Running and debugging browser tests** [references/playwright-tests.md](references/playwright-tests.md)
- **The repo's e2e patterns (projects, fixtures, the fake SDK)** [references/page-objects.md](references/page-objects.md)
- **Turning a CLI session into a spec file** [references/test-generation.md](references/test-generation.md)
- **Request mocking** [references/request-mocking.md](references/request-mocking.md)
- **Running custom Playwright code from the CLI** [references/running-code.md](references/running-code.md)
- **Browser session management** [references/session-management.md](references/session-management.md)
- **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
- **Tracing** [references/tracing.md](references/tracing.md)
- **Video recording** [references/video-recording.md](references/video-recording.md)
- **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)
