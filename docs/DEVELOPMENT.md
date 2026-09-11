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
| `pnpm dev:widget` | widget | `http://localhost:5176` |

Ports are fixed (`strictPort`) so the four servers can run side by side and the e2e tests know where to look. `dev:widget` serves the widget demo page (`src/app/widget/index.html`), a stand-in for a customer's page while developing the widget.

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

To use a real backend, start it with Docker (`docker compose up -d` from the repository root;
see the root `README.md`). Nginx proxies `/api` to the orchestrator and strips the prefix, and
the orchestrator's own routes have no `/api` prefix, so the frontend must go through Nginx, not
straight at the orchestrator's own port. Then create `apps/frontend/.env.development.local`
(git-ignored):

```text
VITE_API_MOCK=false
VITE_API_BASE_URL=http://localhost:8088
```

`http://localhost:8088` is the tested value: it is Nginx's port in the default `docker-compose.yml`.
Docker is only needed for the real backend, not for this repository.

When you add an endpoint, add it to `docs/API.md` and to `src/data/mock/handlers.ts`.

## Translations

Strings live in `src/i18n/locales/<lang>/*.json` (`common` and `admin` namespaces). Every visible text goes through `t()`. The language is client state in Redux (`features/settings`) and is synced to `<html lang dir>` by `LanguageSync`.

Use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `text-start`, `end-*`) so layouts work in RTL.

## Testing the assistant

Every assistant session runs in LiveAvatar sandbox mode: it lasts about a minute and always uses
the public "Wayne" avatar. The browser asks for microphone access on the first conversation;
allow it, or the assistant cannot start. Try the widget at `http://localhost:5176`
(`pnpm dev:widget`) with the demo page's default embed key, `mock-embed-key`, against the mock
API. See `docs/API.md` and `docs/DECISIONS/0010-website-widget.md` for the contract.

## Native shells

After `pnpm build:mobile`, run `pnpm cap:sync` to copy the build into the native Android/iOS
projects. The assistant needs the microphone, so the native shells need it declared before a
device build:

- Android (`android/app/src/main/AndroidManifest.xml`):
  `<uses-permission android:name="android.permission.RECORD_AUDIO" />` and
  `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />`.
- iOS (`Info.plist`): `NSMicrophoneUsageDescription`, the text the system permission prompt shows.

`getUserMedia` only works in a secure context. Capacitor already serves the WebView from
`https://localhost` on iOS and `http://localhost` on Android, and both count as secure, so no
extra configuration is needed for that part.

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

Playwright starts the four dev servers with the mock API and runs `tests/e2e/*.spec.ts`. File names pick the project: `web.*`, `mobile.*`, `admin.*`, `widget.*`.

## Test layout

- `tests/unit/`: pure functions, schemas, reducers, the mock API.
- `tests/integration/`: React pages and guards rendered with `tests/utils/renderWithProviders.tsx` against the mock API.
- `tests/e2e/`: Playwright, one project per target.

## Architecture

Before adding a dependency or abstraction, inspect the existing architecture and documentation.
