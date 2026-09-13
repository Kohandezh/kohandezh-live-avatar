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

The app icon is a rounded square in the HeroUI accent blue (`#0485f7`) with a white speech
bubble holding a "K". The source is `public/icons/favicon.svg` (viewBox `0 0 64 64`). The PNG
sizes (`pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`, `apple-touch-icon.png`)
were rendered from that SVG with macOS `qlmanage -t -s <size> -o <dir> favicon.svg` (the maskable
and apple-touch variants use a full-bleed background with the bubble scaled down so it survives
a circular crop). If you change the mark, re-render the SVG the same way, or with
`rsvg-convert -w <size> -h <size> favicon.svg -o <file>` on Linux/CI.

`pnpm icons` (`scripts/generate-icons.mjs`) is a dependency-free fallback: it draws the same
rounded square and a simplified circle mark in the brand color without any image library, in
case no SVG renderer is available. Prefer rendering `favicon.svg` directly when you can; only
fall back to `pnpm icons` when neither `qlmanage`, `rsvg-convert`, nor `sips` are available.

## HeroUI docs for agents

The UI component library is HeroUI v3 (`docs/DECISIONS/0011-heroui-component-library.md`). An
agent should read the current component docs before using a component, not rely on training
data. Three ways to get them:

1. **MCP server.** `.mcp.json` registers `heroui-react` (`npx -y @heroui/react-mcp@latest`,
   stdio, needs Node 22+). Tools: `list_components`, `get_component_docs`,
   `get_component_source_code`, `get_component_source_styles`, `get_theme_variables`,
   `get_docs`. Restart Claude Code after a change to `.mcp.json`; `/mcp` should then show it as
   Connected.
2. **Skill.** `.claude/skills/heroui-react/` holds the official HeroUI agent skill (`SKILL.md`
   plus scripts). Claude Code discovers it on its own; it can also be called with
   `/heroui-react`. Example: `node .claude/skills/heroui-react/scripts/get_component_docs.mjs Button`.
3. **LLMs.txt.** `https://heroui.com/react/llms.txt` (index), `https://heroui.com/react/llms-full.txt`
   (everything), `https://heroui.com/react/llms-components.txt`, `https://heroui.com/react/llms-patterns.txt`.

Optional local copy: `npx heroui-cli@latest agents-md --react --output AGENTS.md` downloads docs
into `.heroui-docs/` (git-ignored) and injects an index block into `AGENTS.md` between
`<!-- HEROUI-REACT-AGENTS-MD-START -->` and `<!-- HEROUI-REACT-AGENTS-MD-END -->` markers. Do not
commit that block: it points at files that are git-ignored, so it would be broken for everyone
else.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

`pnpm test` runs Vitest once and exits. For watch mode:

```bash
pnpm --filter @app/frontend test:watch
```

The root scripts call `turbo run <task>`, and Turborepo owns the flags after that word. An extra
flag has to be pushed past it with `--`, or Turborepo rejects it as one of its own options:

```bash
pnpm test -- --reporter=verbose        # not: pnpm test --reporter=verbose
pnpm lint -- --fix                     # not: pnpm lint --fix
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
