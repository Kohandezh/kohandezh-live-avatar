---
name: write-tests
description: Generate focused Vitest tests for the frontend in apps/frontend. Covers unit tests for pure logic, Zod schemas and reducers, and integration tests for pages, guards and hooks rendered with the real providers against the mock API. Use this to create the tests that ship with a frontend change, including the failure paths.
---

# Frontend tests (apps/frontend)

You are a test engineer for this repo's React frontend. The runner is **Vitest** with **Testing Library** and **jsdom**. The patterns already exist in `apps/frontend/tests/`. Follow them.

Backend pytest tests are a different skill (`api-test`). Browser tests are a different skill (`e2e-test-gen`). This one covers unit and integration.

## The layout

```text
apps/frontend/tests/
├── setup.ts                 jest-dom, i18n, msw, and the jsdom gaps
├── utils/
│   ├── renderWithProviders.tsx   the only way to render a component here
│   ├── server.ts                 msw server + contract fixtures
│   └── liveAvatarSdkMock.ts      the provider SDK stand-in
├── unit/                    pure logic, schemas, reducers, the mock API
└── integration/             pages, guards and hooks with real providers
```

A test may also sit next to the code (`src/shared/utils/redact.test.ts`). `vitest.config.ts` includes `src/**/*.test.{ts,tsx}` as well as `tests/unit` and `tests/integration`. Put a test next to the code only for a small pure helper that belongs to that file; everything else goes under `tests/`.

## How to run them

```bash
pnpm test                                  # vitest run, from the repository root
pnpm --filter @app/frontend test:watch     # watch mode while writing
pnpm --filter @app/frontend exec vitest run tests/unit/features/settings
```

`restoreMocks: true` is set, so every `vi.fn()` is reset to an empty stub after each test. A mock that must keep an implementation across tests is re-created in `beforeEach`, the way `setup.ts` does for `getUserMedia`.

## Pick the layer

| What you changed | Where the test goes | What it uses |
| ---------------- | ------------------- | ------------ |
| a pure function, a Zod schema, a reducer, a selector | `tests/unit/` | nothing, just the function |
| a component in isolation | `tests/unit/` | `renderWithProviders` |
| a page, a guard, a hook that needs providers | `tests/integration/` | `renderWithProviders` or `providersWrapper` + the mock API |
| a user flow inside a running target | `tests/e2e/` | Playwright, see `e2e-test-gen` |

Do not write an integration test for something a unit test can prove, and do not write a unit test for something that only breaks when the providers are wired together.

## Unit tests

Plain Vitest. `globals: true` is on, so `describe`, `it`, `expect` and `vi` are available without an import, but existing files import them; match the file you are editing.

```ts
import { describe, expect, it } from 'vitest';
import { hasRole } from '@/features/authentication/roles';

describe('hasRole', () => {
  it('is false when there is no user', () => {
    expect(hasRole(null, ['admin'])).toBe(false);
  });

  it('is false for a role the user does not have', () => {
    expect(hasRole({ role: 'user' }, ['admin'])).toBe(false);
  });
});
```

For a Zod schema, test that a **bad** payload is rejected, not only that a good one passes. The schema is the boundary that protects the app from the network, and a schema that accepts anything is the bug.

For a reducer, test the transition and the persisted shape, including the migration case. `settingsSlice` reads an old boolean `reduceTransparency` and maps it to the ends of the numeric scale; that kind of behaviour needs a test or the next refactor drops it.

## Integration tests

Always render through `renderWithProviders`. It gives a fresh Redux store, a fresh `QueryClient` with retries off, a `MemoryRouter` at `route`, and the real `Providers` tree (i18n, React Aria locale, theme, toasts).

```tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@tests/utils/renderWithProviders';

it('sends an anonymous visitor to the login screen', async () => {
  renderWithProviders(<App />, { route: '/settings' });

  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeVisible();
});
```

Options: `route`, `preloadedState` (a `Partial<RootState>`), and `locale` (`'en'` or `'fa'`). Use `locale: 'fa'` to prove a screen survives RTL and longer text.

For a hook, use `providersWrapper()` with `renderHook`. It gives the same providers with no router; a hook that navigates should be tested through `renderWithProviders` instead.

### The two ways to fake the backend

The repo has **both**, on purpose:

1. **`src/data/mock`** (`VITE_API_MOCK`) answers the starter's own routes: auth, users, dashboard. Most integration tests use it.
2. **msw** (`tests/utils/server.ts`) answers the avatar routes, which have no mock adapter. Its `fixtures` mirror `apps/api/services/orchestrator/src/schemas.py`, so they are the contract in test form.

`setup.ts` starts msw with `onUnhandledRequest: 'bypass'`, so a request the msw handlers do not know falls through to the mock API rather than failing. Override a handler for one test with `server.use(...)`; `resetHandlers()` runs after each test.

Use msw when you need a specific failure:

```ts
server.use(
  http.post('*/api/assistant/session', () =>
    HttpResponse.json({ error: { code: 'assistant_rate_limited' } }, { status: 429 }),
  ),
);
```

### What jsdom does not have

`setup.ts` already stubs `matchMedia`, `ResizeObserver`, `URL.createObjectURL`, `document.elementFromPoint`, and `navigator.mediaDevices.getUserMedia`. Read it before adding another stub: the one you want probably exists.

A test that needs a **denied** microphone overrides the default for one call:

```ts
vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
  new DOMException('Permission denied', 'NotAllowedError'),
);
```

## What to cover

A change ships with tests for its failure paths, not only its happy path (`AGENTS.md`, Testing Standard).

For a data-driven screen, that means:

- **loading**: the `LoadingState` is shown before the data arrives
- **success**: the data is rendered
- **empty**: an empty list shows `EmptyState`, not a blank screen
- **error**: a failed request shows `ErrorState`, and `onRetry` actually refetches
- **401 / 403**: an anonymous user is redirected, a disabled account reaches `/forbidden`
- **offline**: `OfflineBanner` where it applies

For a form: the validation message, the pending state on the button, and that the input is kept after a failure.

For anything security-shaped: the **denied** path, always.

## Style

- **Test behaviour, not implementation.** A test that breaks on a refactor with identical behaviour is a bad test.
- Query by role and accessible name (`getByRole`, `getByLabelText`). Use `getByTestId` only when nothing else can reach the element, and say why in a comment.
- `findBy*` for anything async. Do not add an arbitrary `waitFor` with a timeout.
- One behaviour per test, and a name that reads as a sentence about the behaviour.
- Assert the user-visible result, not the call count, unless the call *is* the behaviour (a session that must be stopped on unmount, a microphone track that must be released).
- Never delete or skip a failing test to make CI green. Fix the cause or ask.

## Checklist

- The test fails when the change is removed.
- The failure paths are covered, not only the happy path.
- Rendered through `renderWithProviders`, not a bare `render`.
- New endpoint: a mock route exists in `src/data/mock/handlers.ts` (or an msw handler) and is tested.
- A user-facing string assertion does not hard-code Persian and English in the same test; use `locale` instead.
- `pnpm test` passes, and `pnpm lint` is clean.
