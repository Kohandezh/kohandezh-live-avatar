# CLAUDE.md — Project Instructions

## Role

You are working on a cross-platform React application in a monorepo (ADR 0008). The frontend is
`apps/frontend/`, the backend is `apps/api/`, and shared docs are at the root. Frontend paths below
are relative to `apps/frontend/`.

One frontend codebase builds four targets:

- `mobile`: Android/iOS through Capacitor (`src/app/mobile`, output `dist/mobile`)
- `web`: installable PWA for browsers (`src/app/web`, output `dist/web`)
- `admin`: admin dashboard for staff (`src/app/admin`, output `dist/admin`)
- `widget`: embeddable script for customer websites (`src/app/widget`, output `dist/widget`, ADR 0010)

Read `ARCHITECTURE.md` and the relevant files under `docs/` before making architectural changes.

## Standards

@AGENTS.md

`AGENTS.md` is imported above, so its Engineering Standards and UI/UX Engineering Standards are always in context. This file adds the project rules and the execution workflow. When the two disagree, the more specific rule wins and the disagreement is a doc bug to fix in the same change.

## Core Stack

- React
- TypeScript with strict mode
- Vite (one config, `APP_TARGET` picks the target)
- Tailwind CSS v4
- HeroUI v3 (`@heroui/react`, `@heroui/styles`)
- TanStack Query
- Redux Toolkit
- React Router
- Axios
- Zod
- React Hook Form
- i18next
- Capacitor
- vite-plugin-pwa (web target only)
- Vitest / Testing Library / Playwright

## Architecture

Use this dependency direction:

```text
App entry (src/app/<target>)
  ↓
Pages
  ↓
Features / Entities
  ↓
Shared
  ↓
Platform / API / Storage
```

Do not introduce reverse dependencies.

### App targets

- Each target folder holds only `index.html`, `main.tsx`, `App.tsx`, `router.tsx`, and a layout.
- Shared bootstrap lives in `src/app/` (`providers.tsx`, `store.ts`, `queryClient.ts`, `bootstrap.ts`, `mount.tsx`).
- Admin pages live in `src/pages/admin/` and are imported only by `src/app/admin/router.tsx`. Never import them from the mobile or web router.
- Need to know the target at runtime? Use `env.appTarget` from `src/shared/config/env.ts`. Do not read `import.meta.env` in feature code.
- Build target is not runtime platform. `src/shared/platform` tells whether the code runs inside Capacitor.
- The widget target has no router and no Redux; it renders `features/assistant` inside a Shadow DOM (ADR 0010).

### Pages

Pages compose features and entities. Keep business logic out of pages when it can live in a feature or entity.

### Features

Features represent user-facing workflows such as authentication, the assistant, settings, QR scanning, calendar flows, etc.

### Entities

Entities represent domain concepts and their server data access. Each entity has a Zod schema in `types.ts`, API calls in `api.ts`, and TanStack Query hooks with a `keys` object in `hooks.ts`.

### Shared

Shared code must be domain-agnostic. Do not put product-specific business logic into `shared/`.

## State Management

### Server State

Use TanStack Query for all backend-owned data.

Do not duplicate server state in Redux.

### Client State

Use Redux only for genuinely client-owned global state such as:

- theme
- language (already in `features/settings`)
- UI state
- filters
- temporary workflows

Prefer local React state for state that does not need to be global.

## API

All backend requests must go through `src/shared/api`.

Do not call `fetch` or `axios` directly from pages/components.

The frontend depends on the API contract (`docs/API.md`), not backend implementation details.
The backend is `apps/api/`: Python with FastAPI (ADR 0006). It is a separate application in the
same repository (ADR 0008), reached over HTTP and never imported.

Validate responses with the entity's Zod schema. Errors are `ApiError` (`src/shared/api/errors.ts`).

When you add or change an endpoint, update `docs/API.md` and `src/data/mock/handlers.ts` in the same change.

## Authentication

Login is a phone number plus a one-time code (OTP). There is no password. Web (PWA and admin)
uses secure HttpOnly cookies. The token store is in memory only.

Native uses bearer access tokens:

```text
Authorization: Bearer <token>
```

Native tokens must use OS-backed secure storage. Keep token access behind:

```text
getAccessToken()
setAccessToken()
clearAccessToken()
```

Session state is the `me` query. Protect routes with `RequireAuth` and `RequireRole` from `src/features/authentication`. They are UX only. The backend enforces authorization.

Never log tokens.

## Platform Code

Web and Native implementations must be isolated behind `src/shared/platform`.

Do not import Capacitor plugins directly into domain logic or pages unless there is a strong, documented reason.

## Security

- Backend is the source of truth for authorization.
- Never trust client-side permission checks.
- Never expose private fields through public API responses.
- Use explicit public-field allowlists.
- Never put secrets in frontend source code.
- Use HTTPS outside local development.
- Do not log credentials or sensitive user data.
- Never enable `VITE_API_MOCK` outside development.

## UI

Build screens with HeroUI v3 components. `src/shared/ui` only holds project compositions (Button with spinner, InlineAlert, LoadingState, EmptyState, ErrorState, KeyValue, OfflineBanner). Read the component page before using it: MCP server `heroui-react`, skill `/heroui-react`, or https://heroui.com/react/llms.txt.

Use HeroUI color tokens (`bg-background`, `text-foreground`, `text-muted`, `bg-surface`, `border-border`, ...). No raw palette classes such as `slate-*`.

Every asynchronous data-driven UI must handle:

- loading
- success
- empty
- error

Use `LoadingState`, `EmptyState`, and `ErrorState` from `src/shared/ui`.

Handle unauthorized/offline states where relevant (`OfflineBanner`, `RequireAuth`).

Use existing shared UI components before creating new ones.

## i18n

All user-facing text must use i18n (`src/i18n/locales/<lang>/*.json`, namespaces `common` and `admin`). Add every new key to both `en` and `fa`.

Do not hard-code assumptions about RTL/LTR. Use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `start-*`, `end-*`).

## Dependencies

Do not add a dependency before checking whether the existing stack can solve the problem.

Do not introduce a large library for a small requirement.

If a new dependency is necessary, document the reason in the PR.

## Architecture Changes

Before changing folder boundaries, state management, authentication, API contracts, build targets, or platform abstractions:

1. Read `ARCHITECTURE.md`.
2. Check relevant ADRs in `docs/DECISIONS/`.
3. Prefer the smallest change that solves the real requirement.
4. Update documentation when the architectural decision changes.

## Execution Workflow

Follow "Work in Phases" from `AGENTS.md`. In practice:

### Any task

1. Restate the goal and the scope in one or two lines. Name the targets affected.
2. Explore first. Search for existing components, hooks, entities, i18n keys, tests, and the doc that covers the area. Read `ARCHITECTURE.md` for anything that touches a boundary.
3. For non-trivial work, write a short plan: files to touch, data flow, states, contract changes, tests. Check the STOP conditions in `AGENTS.md`. Ask only when one applies.
4. Implement with the existing patterns. Smallest complete change.
5. Verify with the commands under Validation. Run `pnpm test:e2e` when a user flow changed.
6. Update docs and the mock with the code: `docs/API.md`, `src/data/mock/handlers.ts`, `docs/DATA_MODEL.md`, `CHANGELOG.md`, ADRs.
7. Self-review the diff. Then report: what was done, how it was verified, what was left out and why.

### User-facing change

Before code:

- Inspect the existing screens and components of each affected target.
- Write down the user's goal, the primary action, the entry point, and every state (loading, empty, error, success, offline, 401 and 403, partial data).
- Reuse the states and components in `src/shared/ui`.

After code:

- Run the affected target in the Browser pane (`.claude/launch.json` defines `mobile`, `web`, `admin`, and `widget`). Walk the flow. Check phone width. Switch the language to `fa` for RTL.
- Review against "UI/UX Engineering Standards" 13 and 15 in `AGENTS.md`.
- Fix what you find before reporting.

Do not treat UI/UX validation as a formality. The goal is a UI that fits the product and the user's workflow, not tool approval.

### Challenge the request when needed

If the requested implementation conflicts with the architecture, the design language, or a simpler existing pattern, say so in one or two sentences, propose the alternative, and continue. Preserve the outcome the user wants. If the user reaffirms the request, do it their way and say so.

## Validation

Before considering a change complete:

```bash
pnpm lint
pnpm build
pnpm test
```

`pnpm build` type-checks and builds all four targets. Run `pnpm test:e2e` when the change affects a user flow (needs `pnpm --filter @app/frontend exec playwright install` once).

## Do Not

- Do not create a second API client.
- Do not put server state in Redux.
- Do not access the database from frontend code.
- Do not create generic abstractions without a real use case.
- Do not duplicate Web/Android/iOS business logic.
- Do not silently change API contracts.
- Do not remove existing behavior just to make implementation easier.
- Do not import admin pages into the mobile or web target.
- Do not add a service worker to the mobile target.
