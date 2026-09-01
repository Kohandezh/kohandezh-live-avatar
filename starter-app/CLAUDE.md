# CLAUDE.md — starter-app

Execution guide for this repository. Standards live in `AGENTS.md`; principles in
`ENGINEERING_CONSTITUTION.md`. Read those first, then work here.

## What Is This Project?

A **cross-platform frontend starter**: one shared codebase that ships as a PWA in the browser and
as Android/iOS apps through Capacitor. It talks to an independent backend only through an API
contract (`docs/api/openapi.yaml`). A throwaway `mock-backend/` implements that contract so the app
runs end-to-end locally.

This repo is a **baseline for multiple products**. Keep it product-agnostic. Product-specific
wording, branding, and endpoints belong in the product fork, not here.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (strict, `exactOptionalPropertyTypes`) |
| UI | React 19, React Router 7 |
| Build | Vite 7, `vite-plugin-pwa` (Workbox) |
| Native | Capacitor 7 (Android, iOS) |
| Server state | TanStack Query 5 |
| Client state | Redux Toolkit 2 |
| Validation | Zod |
| i18n | i18next / react-i18next (fa = RTL default, en) |
| Tests | Vitest + Testing Library (+ MSW available) |
| Lint/format | ESLint 9 flat config, Prettier |
| Mock API | Hono on Node (`mock-backend/`) |

## Setup

```bash
pnpm install              # also installs mock-backend/
cp .env.example .env.local   # optional overrides; .env.development is already usable
pnpm dev:all              # web on :5173, mock API on :8787
```

Demo login: `demo@example.com / demo1234` (admin: `admin@example.com / admin1234`).

Native shells:

```bash
npx cap add android && npx cap add ios   # once; android/ and ios/ are gitignored by default
pnpm cap:android | pnpm cap:ios          # build web → sync → open IDE
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` / `pnpm dev:mock` / `pnpm dev:all` | Web dev server / mock API / both |
| `pnpm build` · `pnpm build:staging` | Production / staging bundle (`.env.production` / `.env.staging`) |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Individual gates |
| `pnpm check` | **The gate.** typecheck + lint + format:check + test. Run before every commit. |
| `pnpm cap:sync` | Build and copy web bundle into native projects |

## Project Structure

```
starter-app/
  AGENTS.md                    # Standing rules (judgment, stop conditions, UI/UX standards)
  CLAUDE.md                    # This file — how to execute here
  ENGINEERING_CONSTITUTION.md  # Non-negotiable principles
  docs/
    engineering/               # ARCHITECTURE, API_STANDARDS, SECURITY, DATABASE, TESTING, DECISIONS, AI_ASSISTANCE_LOG
    api/openapi.yaml           # The contract the frontend depends on
    features/INDEX.md          # One folder per feature (RESEARCH.md)
  mock-backend/                # Contract-first mock API (Hono). Not a real backend.
  src/
    main.tsx                   # React root
    app/                       # Bootstrap + global infrastructure
      bootstrap.tsx            #   App component, deep-link hookup
      providers.tsx            #   Redux, QueryClient, i18n, connectivity
      router.tsx               #   Routes + RequireAuth guard
      queryClient.ts           #   TanStack defaults (retry policy)
      config.ts                #   Re-export of shared/config
      store/                   #   Redux store + uiSlice (locale, theme, online)
      layout/AppShell.tsx      #   Header, nav, offline banner
    pages/                     # Route-level composition only (home, login, profile, not-found)
    entities/                  # Domain entities: types + query keys + hooks
      user/                    #   types.ts, queries.ts
    features/                  # Interactive flows
      authentication/          #   useSession/useLogin/useLogout, LoginForm
    shared/                    # Domain-agnostic code
      api/                     #   client.ts (ONLY fetch), errors.ts, auth.ts, users.ts, types.ts
      config/                  #   Zod-validated env (VITE_*)
      platform/                #   camera, notifications, deepLink, share, haptics, connectivity, isNative
      storage/                 #   token.ts (Keychain/Keystore vs cookie no-op), preferences.ts
      i18n/                    #   i18next instance, locales/{fa,en}.json, direction helpers
      ui/                      #   styles.css (tokens), Button, TextField, AsyncState
      hooks/ utils/
    data/                      # Small static build-time data (categories.json)
    test/setup.ts
  .env.development / .env.staging / .env.production / .env.example
  vite.config.ts · vitest.config.ts · capacitor.config.ts · eslint.config.js
  .github/workflows/ci.yml
```

## Architecture (short form — full text in `docs/engineering/ARCHITECTURE.md`)

```
UI (pages) → features / entities → shared/api client → Backend API
                    │                      │
              TanStack Query          Web: HttpOnly cookie
              (server state)          Native: Bearer + secure storage
                    │
                Redux (client state only: locale, theme, UI flags)
```

- **Server state → TanStack Query.** If it comes from or goes back to the server, it is not Redux.
- **Only `shared/api/client.ts` calls `fetch`.** ESLint blocks it elsewhere.
- **Platform differences live in `shared/platform/` and `shared/storage/`.** Features import the
  abstraction, never a Capacitor plugin.
- **Every data-driven screen renders through `AsyncState`** (loading / empty / error / data).
- **Environment = `.env.<mode>`.** Source never changes between dev / staging / production.

## Patterns to Follow

### Adding an entity
1. `src/entities/<name>/types.ts` — domain types (+ a `Public<Name>` allowlist type if exposed publicly).
2. `src/shared/api/<name>.ts` — typed API functions on `api.*`.
3. `src/entities/<name>/queries.ts` — `<name>Keys` + `use…` hooks (query + mutations, invalidation).
4. `src/entities/<name>/index.ts` — public surface.

### Adding a feature
1. `src/features/<flow>/` — hooks + components that combine entities and shared UI.
2. Page composes it in `src/pages/<route>/index.tsx`; add the route in `src/app/router.tsx`.
3. Strings go in `shared/i18n/locales/*.json` (both languages). No hard-coded user-facing text.
4. Wrap data in `AsyncState`. Handle offline (`useOnline`) where the flow can run offline.

### Adding a device capability
1. `src/shared/platform/<capability>.ts` exporting one function with a platform-neutral contract.
2. Web implementation + native implementation (dynamic `import()` of the plugin) inside that file.
3. Export from `shared/platform/index.ts`. Features never import `@capacitor/*` directly.

### Adding client state
Only if the source of truth is the client (locale, theme, filters, wizard step). Add to
`app/store/uiSlice.ts` or a new slice. Persist via `shared/storage/preferences.ts` if needed.

### Changing the API contract
1. Edit `docs/api/openapi.yaml` first. Additive changes only; breaking changes are versioned.
2. Update `mock-backend/src/server.ts` to match.
3. Update `shared/api/*` and entity types. Run `pnpm check`.
4. Record the decision in `docs/engineering/DECISIONS.md` if it changes a rule.

## UI/UX Execution Workflow

For any user-facing feature, follow the UI/UX standards in `AGENTS.md §7`. When the task involves
UI/UX:

1. Inspect existing UI patterns and components before implementing.
2. Identify the user's primary workflow and required interaction states.
3. Implement using existing design-system primitives (`shared/ui`, tokens in `styles.css`).
4. Consider loading, empty, success, error, disabled, offline, responsive, RTL/LTR, and
   accessibility states.
5. Use UI/UX Pro Max or the project's approved validation tooling when applicable.
6. Review the result against the existing product design language.
7. Visually verify in the running app (`pnpm dev:all`), on a narrow viewport too.
8. Fix issues discovered during validation before declaring the task complete.

Do not treat UI/UX validation as a formality. The goal is a UI that is right for the product and
the user workflow, not one that passes a tool.

**Example.** Asked to "implement notifications", do not immediately create a list. First determine
where notifications belong, how users reach them, what read/unread means, how counts behave, the
empty/loading/error states, per-item behavior, whether items navigate, high-volume handling,
mobile vs desktop, and which existing components already solve part of it. Then implement and
validate the complete experience. A feature is complete only when engineering correctness **and**
UX correctness are both met.

## Mandatory Checks Before Every Commit

```bash
pnpm check        # typecheck + lint + prettier + vitest
```

CI (`.github/workflows/ci.yml`) runs the same on every push/PR plus a production build and a
mock-backend smoke test. CI is the pass/fail signal.

## Documentation Rules

| When this happens… | Update |
| --- | --- |
| Starting a feature | `docs/features/<slug>/RESEARCH.md`, `docs/features/INDEX.md` |
| API contract changes | `docs/api/openapi.yaml`, `mock-backend/` |
| Structure or setup changes | Project Structure + Setup here, and `README.md` |
| An architectural decision | `docs/engineering/DECISIONS.md` |
| Auth / token / CORS change | `docs/engineering/SECURITY.md` |
| AI-assisted work in a session | `docs/engineering/AI_ASSISTANCE_LOG.md` |

A doc that contradicts the code is a bug in the doc. Fix it in the same change.

## Working Principles

- Structured, execution-focused, real-world deployable output.
- Follow existing patterns; when in doubt, simplify.
- Backend owns security; frontend owns experience.
- Every screen handles loading, empty, error, and offline. No exceptions.
