# Changelog

## Unreleased

- Switched the package manager from npm to pnpm (ADR 0009). `pnpm-workspace.yaml` replaces the `workspaces` field, and `packageManager` pins the version for `corepack`. Updated CI, `.claude/launch.json`, the Playwright dev-server commands, and every documented command.
- Declared `workbox-window` as a devDependency. `vite-plugin-pwa` generates a virtual module that imports it, but the app had never declared it; npm's flat `node_modules` made it resolve anyway. The web build failed under pnpm until it was declared. This was a real missing dependency, not a pnpm quirk.
- Allowed the `esbuild` install script through `onlyBuiltDependencies`. pnpm 10 blocks dependency install scripts by default, and esbuild needs its own to place the platform binary Vite runs.
- Moved to a monorepo (ADR 0008). The frontend is now `apps/frontend/` and the backend is `apps/api/`. The root `package.json` declares the workspace and delegates every script, so `npm run dev`, `npm run lint`, `npm run build`, `npm test`, and `npm run test:e2e` still run from the repository root. Build output moved to `apps/frontend/dist/<target>/`. No frontend config content changed: they all use `import.meta.dirname` or relative paths. ADR 0004 is superseded in the single-package part only.
- Fixed four e2e tests that failed on a Playwright strict-mode violation. `getByRole('link', { name: 'Log in' })` matched both the navigation link and the "Log in to see your profile" button, because `name` matches by substring. Added `exact: true` to the four ambiguous selectors.
- Recorded the backend stack decision: Python with FastAPI (ADR 0006), chosen because the product's work is mostly machine learning. Proposed generating the API contract from the backend's OpenAPI document (ADR 0007). Updated `ARCHITECTURE.md` (now 0.4), `docs/API.md` (error shape, `202` job convention, SSE streaming), `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md` (cloud and on-premise shapes), `docs/SECURITY.md` (AI gateway logging, upload limits, runtime secrets), `docs/DATA_MODEL.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/CONTRIBUTING.md`.
- Added Engineering Standards and UI/UX Engineering Standards to `AGENTS.md`: engineering judgment, phased workflow, over- and under-engineering rules, STOP conditions, code quality bar, testing and security standards, documentation honesty, and a Definition of Done. `CLAUDE.md` now imports `AGENTS.md` and adds an execution workflow. `docs/CONTRIBUTING.md` and `README.md` point to them.

## 0.3.0

- Split the build into three targets from one codebase: `mobile` (Capacitor), `web` (PWA), and `admin` (dashboard). `APP_TARGET` selects the Vite root; outputs go to `dist/<target>/` (ADR 0004).
- Added the web PWA: `vite-plugin-pwa` manifest, Workbox service worker, update prompt, offline banner, generated placeholder icons (`npm run icons`).
- Added the admin dashboard: login, `RequireAuth` and `RequireRole` guards, sidebar layout, dashboard summary, users table with search and pagination.
- Added the authentication feature (login, logout, session from `GET /api/me`) and the `settings` feature (language in Redux, synced to `<html lang dir>`).
- Wired i18next with `en` and `fa` resources. All UI text goes through `t()`.
- Added Zod schemas for `User`, `DashboardSummary`, and paginated responses.
- Added shared UI components (`Button`, `Input`, `Card`, `Badge`, `Spinner`, `LoadingState`, `EmptyState`, `ErrorState`, `OfflineBanner`).
- Added a mock API (`src/data/mock`) behind `VITE_API_MOCK=true` (ADR 0005). `npm run dev` works without a backend.
- Web token store is now in memory; the web session is a cookie (ADR 0002). Native keeps using the secure-storage adapter.
- Added missing tooling: `@tailwindcss/vite`, `typescript-eslint`, `@capacitor/cli`, `jsdom`, Vitest config, Playwright config, `@/` path alias, `vite-env.d.ts`.
- Added unit, integration, and e2e tests. CI runs Playwright on Chromium.
- Updated `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, and all docs for the three targets.

## 0.2.0

- Added CLAUDE.md.
- Added AGENTS.md.
- Added root ARCHITECTURE.md.
- Added ADRs for architecture, authentication, and state management.
- Added PWA manifest.
- Expanded project documentation and coding-agent rules.
- Added platform abstractions and API/storage boundaries.
