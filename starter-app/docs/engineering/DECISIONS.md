# Architecture Decision Records

Format: `ADR-NNN · Title · Status · Date` then Context / Decision / Consequences. Never delete an
ADR; supersede it.

## ADR-001 · React + Vite SPA/PWA with Capacitor · Accepted · 2026-09-01
**Context.** One codebase for Web, Android, iOS; the architecture doc names TanStack Query, Redux,
and Capacitor. Next.js would add SSR and routing conventions that fight Capacitor's static bundle.
**Decision.** Vite SPA with `vite-plugin-pwa`; Capacitor wraps `dist/`.
**Consequences.** No SSR/SEO by default (add prerendering per product if needed). Simple deploys.

## ADR-002 · Dual auth transport (cookie on web, Bearer on native) · Accepted · 2026-09-01
**Context.** Native WebViews run on a local origin where cross-site cookies are unreliable.
**Decision.** Client declares `X-Auth-Mode`; backend supports both; one identity model. Native
tokens only in secure storage behind `shared/storage/token.ts`.
**Consequences.** Backend must implement both. Refresh rotation to be added when available.

## ADR-003 · Server state in TanStack Query, client state in Redux · Accepted · 2026-09-01
**Context.** Two sources of truth for server data cause stale UI and invalidation bugs.
**Decision.** Ownership decides the store, not preference. Redux holds only client-owned state.
**Consequences.** Redux stays small. Session/user data is a query, not a slice.

## ADR-004 · Layer boundaries enforced by ESLint · Accepted · 2026-09-01
**Decision.** `app → pages → features → entities → shared`; `fetch` only in `shared/api/client.ts`.
**Consequences.** Some friction when prototyping; prevents the most common architecture rot.

## ADR-005 · Mock backend lives in this repo, is not a backend · Accepted · 2026-09-01
**Decision.** `mock-backend/` implements `openapi.yaml` for local end-to-end runs and CI smoke.
**Consequences.** Must be kept in sync with the contract; never deployed; no security features.
