# Changelog

## Unreleased

- Replaced email/password login with phone login (ADR 0002 stays the model, the credential
  changes). A user enters a phone number, gets a one-time code, and verifies it. Web keeps the
  code in the `kd_session` HttpOnly cookie; native gets a bearer token. In development the code
  is `console`-delivered and also returned as `devCode` so the flow can be tested without SMS.
  In staging and production, `OTP_DELIVERY=asanak` sends the code by real SMS through Asanak,
  from the customer's sender line using the approved OTP template (both set in `.env`). Phones listed in `ADMIN_PHONES`
  get the admin role. New backend routes `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`,
  `POST /api/auth/logout`, and a `users` table (migration `002_assistant.sql`).
- Added the real-time assistant: one shared `features/assistant` feature and
  `entities/assistant-session` entity, used by the mobile app, the web app, and the website
  widget. It has a voice mode and a video mode, a transcript of the conversation, mic mute,
  interrupt, and a countdown for the sandbox time limit. The backend mints a LiveAvatar session
  token per conversation (`POST /api/assistant/session`, `POST /api/assistant/session/{id}/close`)
  and the browser drives the session with LiveAvatar's own SDK, so nothing of ours needs to be
  publicly reachable. Every session runs in LiveAvatar sandbox mode: no credits are spent, the
  session ends after about 60 seconds, and only the public "Wayne" avatar is used.
- Added two provider modes for the assistant, chosen by backend configuration. Persian
  conversations use LiveAvatar's stored Voice Agent (`LIVEAVATAR_VOICE_AGENT_ID`), which wraps
  the customer's own ElevenLabs agent; English conversations use LiveAvatar FULL mode with a
  Context persona (`LIVEAVATAR_CONTEXT_ID`), and fall back to a supported language when the
  caller asks for one FULL mode cannot start. The response carries `agentType: "elevenlabs" |
  "full"` so the frontend picks the matching SDK session class, and duplicate transcript events
  from the two providers are removed. Reason: LiveAvatar FULL mode does not support Persian today
  (`language: "fa"` is accepted when the token is minted but rejected at session start, and no
  STT provider or the ElevenLabs model behind FULL mode understands Persian yet), while the
  customer's ElevenLabs agent and LiveAvatar Voice Agent pairing already speaks Persian with a
  cloned voice. Verified against the real provider on 2026-09-11: both paths mint a token, start
  a sandbox session, and stop it cleanly.
- Added the website widget: a fourth Vite build target (`APP_TARGET=widget`, ADR 0010) that
  builds the shared assistant panel into one script a customer adds with a `<script>` tag. It
  renders inside a Shadow DOM so none of the widget's styles leak onto the customer's page and
  none of the customer's styles leak in. It authenticates with a public embed key
  (`ASSISTANT_EMBED_KEY`) instead of a user session; an origin allowlist
  (`ASSISTANT_EMBED_ALLOWED_ORIGINS`) and a per-visitor rate limit
  (`ASSISTANT_RATE_LIMIT_PER_HOUR`) are what actually protect the account, because the key itself
  is public. The widget has no router and no Redux store.
- Added explicit CORS: FastAPI now rejects any browser origin not in `CORS_ALLOWED_ORIGINS`, with
  credentials allowed only for that list. The website widget's allowed origins are added to it
  automatically.
- Ignored `.claude/worktrees/` in `.gitignore`. The desktop app checks out one worktree per
  agent there, and those checkouts must never be committed.
- Updated the end-to-end and mock-API coverage for all of the above: the web smoke test now
  expects login to land on `/assistant` (the product's main screen, replacing the old redirect to
  home), and `src/data/mock/handlers.ts` grew routes for OTP request/verify and for the assistant
  session so `pnpm dev` still works without a backend.
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
