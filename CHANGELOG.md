# Changelog

## Unreleased

- The documented test command works again. Since the Turborepo migration, `pnpm test --run` was
  parsed by `turbo` as one of its own options: it printed a usage dump, ran zero tests, and looked
  like a test failure. `@app/frontend`'s `test` script is now `vitest run`, so the command is plain
  `pnpm test` everywhere (docs, CI). Watch mode moved to
  `pnpm --filter @app/frontend test:watch`.
- Added an optional date of birth. Onboarding step 1 now collects it next to the name, and it
  stays editable on `/settings/personal`. The field is a Jalali (Solar Hijri) date: the user
  types Persian years and months, and the app stores a Gregorian `YYYY-MM-DD`. The calendar is
  forced to Persian in both interface languages, so the birthday reads the same in `fa` and in
  `en`. `users.birth_date` (migration `003_birth_date.sql`) holds it, `PUT /api/me/profile`
  accepts and clears it, and `GET /api/me` returns it. Conversion lives in one file,
  `src/features/profile/jalali.ts`, built on `@internationalized/date`, the calendar engine
  React Aria already uses. Leaving the field empty is fine and does not block onboarding.
  The shared name fields grew into `ProfileFields`, used by both screens: the endpoint is a
  full replace, so a screen that left the birthday out would clear it on every save.
- The theme picker on `/settings/appearance` is a HeroUI `ListBox` instead of a radio group.
  The rows are full-width press targets and the list cannot end up with nothing selected.
- "Reduce transparency" became a slider, 0 to 100, instead of an on/off switch. The glass
  effect now scales with the level: blur, saturation, brightness and the edge ring fade out
  while the tint fades in, so the middle of the slider is a real middle. The top of the scale
  still drops `backdrop-filter` outright rather than leaving a `blur(0px)` compositing layer.
  A setting saved as the old boolean is read back as 0 or 100, so nobody's choice resets.

- Added `PUT /api/me/profile` so a signed-in user can set their first and last name. It is a
  full replace: both fields are required, and the response is the whole updated user. No
  migration was needed; the `users` table already had `first_name` and `last_name` columns.
  The frontend treats an empty `firstName` as the signal that onboarding is not finished; there
  is no separate "new user" flag.
- Turned the MVP into the product "Dr. Kohandezh Assistant" (Persian: دستیار دکتر کهن‌دژ). Every
  starter string ("Cross-Platform App", "One codebase for mobile, web, and admin", the Phase 1
  status text) is gone from the four targets, the HTML titles, the PWA manifest, and the
  Capacitor config (`com.kohandezh.assistant`). New app icon (accent-blue rounded square with a
  speech bubble) in `public/icons/`, generated from `favicon.svg`; the workflow is in
  `docs/DEVELOPMENT.md`. Persian text now renders in Vazirmatn (`@fontsource/vazirmatn`,
  weights 400/500/700, imported by the mobile, web, and admin entries; the widget keeps the
  system font because `@font-face` does not work inside its Shadow DOM).
- Reworked navigation for the mobile app and the web PWA. `/` is a landing screen for visitors
  (what the product is, one "Start a conversation" action, three "How it works" steps) and sends
  a signed-in user straight to `/assistant`. The mobile tab bar has two tabs, Conversation and
  Profile, and is hidden until the user signs in. The web header shows Conversation and Profile
  only when signed in, and the Phase 1 workbench link (`/avatar`) only to admins; the route
  itself is unchanged. The profile page became an account page (avatar with initials, details,
  a settings card with the language select, log out). Not found and forbidden pages use the
  shared `EmptyState`. See the Navigation section in `ARCHITECTURE.md`.
- Finished the HeroUI v3 migration in the pages, layouts, and features that still used raw
  palette classes. Language switching uses HeroUI `Select`; the voice/video switch and the
  widget language switch use `ToggleButtonGroup`; the widget close control is `CloseButton`; the
  admin users screen uses `SearchField`, `Table`, and `Pagination`; the admin layout uses
  `Avatar` and token colors. Transcript turns render as chat bubbles and the avatar's turns are
  labelled "Dr. Kohandezh". The sandbox chip reads "Trial mode".
- Removed unused Phase 1 i18n keys (`home.intro`, `home.phase*`, `home.webrtc*`,
  `app.phaseNotice`, the `settings` group, ...) after checking that no code reads them.
- Added `*-mock` entries to `.claude/launch.json` that start each target against the mock API
  regardless of `.env.development.local`, for browser verification without the backend.
- Fixed the website widget for mouse users. React Aria checks which element is under the
  pointer when a press ends; inside the widget's Shadow DOM that element is the shadow host, so
  every mouse click on a HeroUI button (including Start) was cancelled while touch worked. The
  widget mount now calls `enableShadowDOM()` from `react-stately` before the first render, and
  `react-stately` is declared as a direct dependency for that import. `border-solid` is set
  explicitly where the widget draws borders, because Tailwind v4's `@property` border style is
  not applied inside a shadow root.
- Tests: new integration tests for the landing (`homePage.test.tsx`), the mobile tab bar
  (`mobileLayout.test.tsx`), and admin pagination; the e2e specs assert the product strings.

- Adopted HeroUI v3 (`@heroui/react`, `@heroui/styles`) as the component library across mobile,
  web, admin, and widget, replacing the hand-made Tailwind components in `src/shared/ui`. See
  `docs/DECISIONS/0011-heroui-component-library.md` for the reasons and the component mapping.
  Added agent tooling for it: the `heroui-react` MCP server (`.mcp.json`) and the HeroUI agent
  skill (`.claude/skills/heroui-react/`).
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
