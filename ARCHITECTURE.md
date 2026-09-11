# ARCHITECTURE

Version: 0.5

## Overview

One repository holds two applications (ADR 0008):

```text
apps/frontend/                          apps/api/
  one React/TypeScript codebase           Python / FastAPI
  four build targets                      (ADR 0006)
```

Inside `apps/frontend`, one shared codebase builds four apps (called "targets"):

```text
                         Shared Codebase
              pages · features · entities · shared · i18n
                              │
      ┌───────────────┬───────┴───────┬────────────────┐
      │               │               │                │
src/app/mobile   src/app/web    src/app/admin   src/app/widget
      │               │               │                │
  Capacitor      Browser PWA    Admin dashboard   Script on the
 Android · iOS  (service worker)  (staff only)   customer's site
      │               │               │                │
      └───────────────┴───────────────┴────────────────┘
                              │
                              ▼ HTTP only
                     apps/api  (Python / FastAPI)
```

All paths below are relative to `apps/frontend/` unless they start with `apps/` or `docs/`.

Core principles:

- One shared frontend codebase, several build targets.
- Backend is independent and accessed through APIs (ADR 0006).
- No direct database access from frontend.
- Server state belongs to TanStack Query.
- Client-owned global state belongs to Redux.
- Platform-specific behavior is isolated behind abstractions.
- Native credentials use secure storage.
- Backend owns authorization.
- Public API responses use explicit allowlists.
- Prefer simplicity and avoid premature abstraction.

## App Targets

A target is selected at build time with the `APP_TARGET` environment variable (`mobile`, `web`, `admin`, or `widget`). See `vite.config.ts`, ADR 0004, and ADR 0010 for the widget.

| Target   | Entry folder      | Output         | Extra                                              |
| -------- | ----------------- | -------------- | -------------------------------------------------- |
| `mobile` | `src/app/mobile/` | `dist/mobile/` | Capacitor `webDir`. No service worker.             |
| `web`    | `src/app/web/`    | `dist/web/`    | `vite-plugin-pwa`: manifest + Workbox.             |
| `admin`  | `src/app/admin/`  | `dist/admin/`  | Login + admin role guard on every route.           |
| `widget` | `src/app/widget/` | `dist/widget/` | One IIFE script, Shadow DOM, embed key (ADR 0010). |

Each entry folder contains only `index.html`, `main.tsx`, `App.tsx`, a router, and a layout.
The widget is the exception: it has one screen, so it has no router, and its `index.html` is a
demo page rather than the app shell. Everything else is shared. Rules:

- Admin code is never bundled into the mobile or web app. Admin pages live under `src/pages/admin/` and are only imported by `src/app/admin/router.tsx`.
- Mobile and web share the same user pages. They differ in layout (bottom tab bar vs. top navigation) and in the PWA service worker.
- Code that needs to know the target reads `env.appTarget` from `src/shared/config/env.ts`. Do not read `import.meta.env` in feature code.
- The build target is not the runtime platform. `src/shared/platform` answers "am I inside Capacitor?" at runtime.
- The widget renders the shared `features/assistant` panel. It has no Redux store and no service worker, and it authenticates with a public embed key instead of a user session (ADR 0010).

## System Boundaries

Frontend owns UI, navigation, client state, API consumption, local persistence, platform integration, and user interaction.

Backend owns authentication, authorization, business logic, persistence, API contracts, validation, and security-sensitive operations.

```text
Frontend
   │ HTTPS / API
   ▼
Backend
   │
   ▼
Database
```

## Backend

The backend is `apps/api/` (ADR 0008). It is Python with FastAPI (ADR 0006), chosen because the
product's work is mostly machine learning: speech to text, embeddings, retrieval, and locally
hosted models.

Same repository, but not the same program. The frontend reaches the backend over HTTP and never
imports from it. It depends on the contract in `docs/API.md`, not on the backend language. A product
built from this starter can replace `apps/api` with any backend that implements the same contract.

`apps/api` is not a pnpm workspace package. Python has its own dependency file.

Two deployment shapes are supported, and the frontend must work in both:

| Shape      | Layout                                                         | CORS                          |
| ---------- | -------------------------------------------------------------- | ----------------------------- |
| Cloud      | Frontend and API on different origins                          | Explicit origins, credentials |
| On-premise | One web server serves `dist/` and proxies `/api` on one origin | Not needed (same origin)      |

Long operations (audio transcription, document indexing) do not run inside a request. The API
accepts the work, answers `202` with a job id, and the frontend polls the job. See `docs/API.md`.

## Authentication

Web (PWA and admin) should prefer:

```text
HttpOnly + Secure + SameSite Cookie
```

Native may use:

```text
Authorization: Bearer <access_token>
```

Native tokens must be stored in OS-backed secure storage such as iOS Keychain or Android Keystore.

Token access must be abstracted behind `getAccessToken`, `setAccessToken`, and `clearAccessToken` (`src/shared/storage/tokenStore.ts`). On web the token store is in memory only.

Session state is the `me` query (`GET /api/me`) in TanStack Query. `RequireAuth` and `RequireRole` (`src/features/authentication/guards.tsx`) protect routes. They improve UX only. The backend must check the role on every request.

## Real-time Assistant

`POST /api/assistant/session` mints a LiveAvatar session token with the backend's own provider
API key and records the session; nothing of ours has to be publicly reachable. The browser then
drives the conversation itself with LiveAvatar's SDK, which joins a LiveKit room the provider
hosts. Two provider modes, chosen by backend configuration: a stored LiveAvatar Voice Agent
wrapping the customer's ElevenLabs agent (Persian), and LiveAvatar FULL mode with a Context
persona (English; FULL mode does not support Persian yet). The response's `agentType` tells the
frontend which SDK session class to use. Every session runs in LiveAvatar sandbox mode: no
credits are spent, the session ends after about 60 seconds, and only the public sandbox avatar is
used; the backend enforces this and the client cannot turn it off. See `docs/API.md` and
`docs/DECISIONS/0010-website-widget.md`.

## API Layer

All backend communication goes through `src/shared/api`.

```text
UI
 ↓
Feature / Entity Hook
 ↓
API Client (axios, one instance)
 ↓
Backend
```

Responses are validated with Zod schemas in the entity (`src/entities/*/types.ts`). Errors are normalized into `ApiError` (`src/shared/api/errors.ts`).

In development, `VITE_API_MOCK=true` swaps the axios adapter for `src/data/mock` (ADR 0005). The mock is loaded on demand and is not part of a normal bundle.

The written contract is `docs/API.md`. Once ADR 0007 is accepted, the backend's OpenAPI document
becomes the source of truth and the entity schemas are generated from it.

## API Access Levels

```text
Public
Authenticated
Privileged (admin)
```

Public responses must use explicit field allowlists.

## Frontend Layers

These live under `apps/frontend/src/`.

- `app/`: shared bootstrap (`providers.tsx`, `store.ts`, `queryClient.ts`, `bootstrap.ts`, `mount.tsx`) plus one entry folder per target.
- `pages/`: route-level composition. `pages/admin/` holds admin-only screens.
- `entities/`: domain entities, Zod schemas, and server data access (`user`, `dashboard`, `assistant-session`).
- `features/`: user-facing workflows (`authentication`, `assistant`, `settings`).
- `shared/`: reusable domain-agnostic infrastructure (`api`, `ui`, `hooks`, `storage`, `platform`, `config`, `utils`).
- `data/`: static and mock data.
- `i18n/`: localization (`en`, `fa`).
- `styles/`: global styles.

Dependency direction:

```text
app → pages → features / entities → shared → platform / api / storage
```

`data/mock` may import types from `entities` (type-only) and is only imported by `app/bootstrap.ts`.

## State

Backend-owned data uses TanStack Query.

Client-owned global state uses Redux Toolkit (today: language in `features/settings`).

Prefer local React state for local UI state.

## Platform Abstraction

Platform-specific capabilities live under:

```text
shared/platform/
```

Examples include camera, notifications, deep links, haptics, sharing, and device storage.

## Environments

- Development
- Staging
- Production

Environment configuration must not require source-code changes. See `.env.example`.

## Security

Backend is the source of truth for authorization.

Never trust client-side permissions.

Never expose secrets in frontend code.

Sensitive APIs require explicit authentication, authorization, and CORS configuration. Cookie auth needs `Access-Control-Allow-Credentials: true` with explicit origins for the web and admin hosts.

## Architectural Rules

1. One source of truth.
2. Server state is not Redux state.
3. Backend owns security.
4. Platform differences are isolated.
5. API exposure is explicit.
6. Shared code is preferred.
7. No direct database access.
8. API contract over backend internals.
9. Prefer simplicity.
10. Avoid premature abstraction.
11. Explicit ownership of state and logic.
12. Loading, empty, error, offline, and unauthorized states are first-class where applicable.
13. Admin code stays out of user-facing bundles.
