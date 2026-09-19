# Running and Debugging Browser Tests

Browser tests here are `@playwright/test` specs in TypeScript. The config is
`apps/frontend/playwright.config.ts`.

## Setup, once

```bash
pnpm install
pnpm --filter @app/frontend exec playwright install
```

CI installs only Chromium (`playwright install --with-deps chromium`), and every project
uses a Chromium device, so Chromium alone is enough locally too.

## Running

```bash
# the whole suite, all four projects, from the repository root
pnpm test:e2e

# one project
pnpm --filter @app/frontend exec playwright test --project=mobile

# one file
pnpm --filter @app/frontend exec playwright test tests/e2e/mobile.login.spec.ts

# one test by name
pnpm --filter @app/frontend exec playwright test -g "the OTP step renders six separate slots"
```

Playwright starts the dev servers itself (`webServer` in the config), on ports 5273 to
5276 with `VITE_API_MOCK=true`. You do not need `pnpm dev` running, and if it is running
the suite ignores it: the ports are different on purpose, so the tests never attach to a
server pointed at the real backend.

`reuseExistingServer` is on outside CI, so a second run reuses the servers from the
first. That makes the loop fast. It also means a stale server can outlive a config change:
kill the ports if behaviour stops matching the code.

## Debugging

```bash
# watch it happen
pnpm --filter @app/frontend exec playwright test --headed --project=mobile

# step through with the inspector
pnpm --filter @app/frontend exec playwright test --debug tests/e2e/mobile.login.spec.ts

# the UI mode: time travel, locator picker, watch mode
pnpm --filter @app/frontend exec playwright test --ui

# open the HTML report from the last run
pnpm --filter @app/frontend exec playwright show-report
```

`trace: 'on-first-retry'` is set, so a test that fails and retries leaves a trace:

```bash
pnpm --filter @app/frontend exec playwright show-trace test-results/<path>/trace.zip
```

Retries are `2` in CI and `0` locally. A test that only passes on a retry is flaky, and
flaky is a finding, not a pass.

## Reading a CI failure

The `e2e` job uploads `apps/frontend/playwright-report` on failure:

```bash
gh run list --branch <branch> --limit 1
gh run view <run-id> --log-failed
gh run download <run-id> -n playwright-report
pnpm --filter @app/frontend exec playwright show-report <downloaded-dir>
```

Read the report before changing anything. `reporter: 'github'` in CI annotates the failing
lines directly on the PR, which is usually enough to see the cause.

## Naming, or the test will not run

`testMatch` picks the project from the file name:

| Pattern              | Project  | Port |
| -------------------- | -------- | ---- |
| `mobile.*.spec.ts`   | `mobile` | 5273 |
| `web.*.spec.ts`      | `web`    | 5274 |
| `admin.*.spec.ts`    | `admin`  | 5275 |
| `widget.*.spec.ts`   | `widget` | 5276 |

A file that matches none of these is collected by no project and silently never runs.
If a new test "passes" instantly, check the name first.

## Before you push

```bash
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
```

CI is still the gate. The `e2e` job needs the `frontend` job to pass first, so a type
error means the browser tests never even run.
