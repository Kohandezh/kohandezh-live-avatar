# DEVELOPMENT

## Requirements

- Node.js 22 LTS or newer
- pnpm 10 or newer (`corepack enable pnpm`, or install it yourself)
- Android Studio for Android development
- Xcode for iOS development

## Install

```bash
pnpm install
```

## Run one target

| Command              | Target | URL                     |
| -------------------- | ------ | ----------------------- |
| `pnpm dev:mobile` | mobile | `http://localhost:5173` |
| `pnpm dev:web`    | web    | `http://localhost:5174` |
| `pnpm dev:admin`  | admin  | `http://localhost:5175` |

Ports are fixed (`strictPort`) so the three servers can run side by side and the e2e tests know where to look.

`APP_TARGET` is a normal environment variable. On Windows `cmd` or PowerShell, run for example:

```bash
pnpm dlx cross-env APP_TARGET=admin vite
```

## Mock API

`.env.development` sets `VITE_API_MOCK=true`, so `vite` answers API calls from `src/data/mock` and no backend is needed.

Login is phone + one-time code. The mock accepts the code `123456` for every phone number.
Demo accounts:

- `+989121234567` (role `admin`)
- `+989351234567` (role `user`)

Verifying a phone number that is not in the demo list creates a new `user`-role account on the
spot, same as the real backend. The code input's own "Development code" hint shows `123456` too,
copied from the mock's `devCode` response field.

To use a real backend, start `apps/api` (Python / FastAPI, ADR 0006), then create
`apps/frontend/.env.development.local` (git-ignored):

```text
VITE_API_MOCK=false
VITE_API_BASE_URL=http://localhost:8000
```

Docker is only needed for the real backend, not for this repository.

When you add an endpoint, add it to `docs/API.md` and to `src/data/mock/handlers.ts`.

## Translations

Strings live in `src/i18n/locales/<lang>/*.json` (`common` and `admin` namespaces). Every visible text goes through `t()`. The language is client state in Redux (`features/settings`) and is synced to `<html lang dir>` by `LanguageSync`.

Use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `text-start`, `end-*`) so layouts work in RTL.

## Icons

`pnpm icons` writes placeholder PWA icons to `public/icons/`. Replace them with real brand icons before release.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test --run
```

## End-to-end tests

```bash
pnpm --filter @app/frontend exec playwright install     # once, downloads browsers
pnpm test:e2e
```

Playwright starts the three dev servers with the mock API and runs `tests/e2e/*.spec.ts`. File names pick the project: `web.*`, `mobile.*`, `admin.*`.

## Test layout

- `tests/unit/`: pure functions, schemas, reducers, the mock API.
- `tests/integration/`: React pages and guards rendered with `tests/utils/renderWithProviders.tsx` against the mock API.
- `tests/e2e/`: Playwright, one project per target.

## Architecture

Before adding a dependency or abstraction, inspect the existing architecture and documentation.
