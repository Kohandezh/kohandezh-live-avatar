# ARCHITECTURE — Cross-Platform PWA / Mobile Application

Version: 0.1 · Status: **binding target architecture**. Where the code differs, see "Current state"
notes at the end and `DECISIONS.md`.

## 1. Overview

One shared frontend codebase runs as a PWA in the browser and as native apps through Capacitor.

```
                         Shared Codebase
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                PWA       Capacitor     Other Web
             Browser       ┌────┴────┐    Targets
                 │         │         │
                 │       Android    iOS
                 └─────────┴─────────┘
                              │
                              ▼
                    Existing Backend / BaaS
                              │
                 ┌────────────┼────────────┐
              Identity      Domain       Other
              / Auth         APIs         APIs
```

Principles: single shared frontend codebase · backend independent from frontend · frontend never
accesses the database · communication through a well-defined API contract · Web/Native
differences isolated behind abstractions · business logic independent of platform · Web, Android,
iOS without separate codebases.

## 2. System boundaries

**Frontend** owns UI, navigation, client state, API consumption, local persistence, platform
integrations, user interactions. **Backend** owns authentication, authorization, business logic,
persistent data, API endpoints, server-side validation, security-sensitive operations.

```
Frontend ──HTTPS/API──▶ Backend ──▶ Database
```

The frontend must never connect directly to the backend database. Both sides are versioned,
tested, and deployed independently.

## 3. Authentication and session management

| Client | Mechanism | Why |
| --- | --- | --- |
| Web | `HttpOnly; Secure; SameSite` cookie | Token not reachable from JavaScript |
| Native (Capacitor) | `Authorization: Bearer <access_token>` | App runs on a local origin; cookie semantics unsuitable cross-origin |

The backend supports both; both resolve to the same identity and authorization model. The client
declares its mode with `X-Auth-Mode: cookie|bearer` on login (see `openapi.yaml`).

Native tokens are stored only in iOS Keychain / Android Keystore, behind
`shared/storage/token.ts` (`getAccessToken / setAccessToken / clearAccessToken`). Changing the
storage implementation changes one file.

## 4. API layer

All backend communication goes through `src/shared/api/`:

```
client.ts   base URL · auth transport · headers · timeout · error normalization · JSON
errors.ts   ApiError { status, code, serverCode, details, isRetryable }
auth.ts / users.ts / …   typed endpoint functions
```

Flow: `UI → feature/entity hook → API client → backend`. Pages and components never call
`fetch`/`axios` directly (ESLint enforces it).

## 5. Backend API contract

`docs/api/openapi.yaml` is the dependency. It defines request/response schemas, auth requirements,
error format, pagination, filtering, sorting, rate limits, versioning. The frontend never manages
backend migrations; the backend never depends on frontend internals.

## 6. Public / authenticated / privileged APIs

```
              API
   ┌───────────┼───────────┐
 Public   Authenticated  Privileged
```

Public responses use explicit field allowlists (`PUBLIC_FIELDS = [...]`), never "return all
fields". The mock backend demonstrates this; the real backend must do the same.

## 7. Frontend structure

```
src/
  app/        router · providers · store · bootstrap · config · layout
  pages/      route-level composition (no business logic)
  entities/   domain entities: types, query keys, queries, mutations, hooks
  features/   interactive flows combining entities + shared
  shared/     api · ui · hooks · utils · i18n · platform · storage · config
  data/       small static build-time data
```

Import direction: `app → pages → features → entities → shared`. Never the reverse.

## 8. State management

| State | Owner | Examples |
| --- | --- | --- |
| Server state | TanStack Query | users, profile, messages, server preferences |
| Client state | Redux | locale, theme, filters, UI flags, wizard/scanner state |

Rule: if it comes from the server or must be persisted back to the server, it is server state by
default. TanStack Query provides caching, fetching, sync, loading/error states, retry, invalidation.

## 9. Local data

`src/data/*.json` for categories, static configuration, rarely changing content. Move to the
backend when it needs frequent updates, admin management, personalization, server-side search,
analytics, permissions, or multi-user sync.

## 10. Loading, empty, error states

```
Loading ─┬─ Success ──▶ Data
         ├─ Empty   ──▶ Empty state
         └─ Error   ──▶ Error state (retry only if retryable)
```

`shared/ui/AsyncState` is the standard wrapper. Never assume APIs are fast, requests succeed, data
exists, or the network is available (`useOnline`, offline banner in `AppShell`).

## 11–12. Platform abstraction and device features

```
Feature ──▶ shared/platform/<capability> ──┬── Web implementation
                                            └── Native implementation (Capacitor plugin)
```

Provided: camera, push notifications, deep links, share, haptics, connectivity, secure token
storage, key/value preferences. Add new capabilities the same way.

## 13. Internationalization

All user-facing text goes through `shared/i18n`. Supports language, direction (fa → RTL, en →
LTR via `document.dir`), number/date formatting via `Intl`, pluralization via i18next. Components
use logical CSS properties and never hard-code direction.

## 14. Environments

| Mode | File | Purpose |
| --- | --- | --- |
| development | `.env.development` | daily development against mock or dev backend |
| staging | `.env.staging` | pre-production |
| production | `.env.production` | live |

`shared/config` validates `VITE_*` at boot with Zod. Source never changes between environments.

## 15. Deployment

```
Shared source ─┬─ Web:     vite build → static hosting (+ service worker)
               ├─ Android: cap sync → Gradle → APK / Play
               └─ iOS:     cap sync → Xcode → App Store
```

Independent pipelines, same source. Environment is a build input, never a fork.

## 16. Security principles

See `SECURITY.md`. Summary: backend is the source of truth for authorization; client is never
trusted; private data never in public responses; native tokens in secure storage; explicit
allowed origins; no unrestricted CORS on sensitive APIs; backend validates input; no secrets or
sensitive data in logs, errors, or the bundle.

## 17. Repository boundaries

Frontend repo owns UI, client state, API integration, platform integration, UX. Backend repo owns
API, database, migrations, auth, business logic. This repo's `mock-backend/` is a **stand-in for
the contract**, not a backend implementation.

## 18. API evolution

1. Add new capability → 2. update frontend consumers → 3. migrate existing consumers →
4. deprecate → 5. remove. Never break an existing API to simplify a frontend change. Unavoidable
breaks are versioned or coordinated across all consumers.

## 19. Architectural rules

1 One source of truth · 2 Server ≠ client state · 3 Backend owns security · 4 Platform isolation ·
5 Explicit data exposure · 6 Shared code first · 7 No direct DB access · 8 API contract first ·
9 Prefer simplicity · 10 Avoid premature abstraction · 11 Explicit ownership · 12 Fail explicitly.

## 20. Summary

```
                         APPLICATION
              ┌───────────────┴───────────────┐
             UI                          Application Logic
              └───────────────┬───────────────┘
                     Features / Entities
                 ┌────────────┴────────────┐
           Server State              Client State
          TanStack Query                Redux
                 └────────────┬────────────┘
                         Shared API
                    ┌─────────┴─────────┐
                  Web                Native
                Cookie          Bearer Token → Secure Storage
                    └─────────┬─────────┘
                         Backend API
                    ┌─────────┴─────────┐
                Business            Database
                 Logic
```

## Current state vs target (honest notes)

- Native shells (`android/`, `ios/`) are not committed; generate with `npx cap add`.
- Web Push on the web platform is not wired (native push is). Add a push service worker when a
  product needs it.
- `mock-backend` uses plaintext passwords and in-memory sessions by design. It is not a backend.
