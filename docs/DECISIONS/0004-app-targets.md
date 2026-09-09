# ADR 0004 — Three App Targets From One Codebase

## Status

Accepted. The single-package part is superseded by ADR 0008: the package moved to
`apps/frontend/`. Everything else below still holds inside that folder.

## Context

The product needs three deliverables: a native mobile app (Capacitor), a separate web app that installs as a PWA, and an admin dashboard for staff. They share the backend, the domain model, and most UI code, but they have different shells, different routes, and different build needs (only the web app needs a service worker, only the admin app needs the admin screens).

Options considered:

1. One app, one build, admin routes behind a role check. Simple, but admin code ships inside the mobile app, and a service worker would run inside Capacitor.
2. A monorepo with three packages. Clear boundaries, but much more tooling (workspaces, per-package configs, shared package builds) for a starter.
3. One package with one entry folder per target and `APP_TARGET` selecting the Vite root. Small change, three real bundles.

## Decision

Option 3. `vite.config.ts` reads `APP_TARGET` (`mobile`, `web`, `admin`), sets `root` to `src/app/<target>/`, and writes to `dist/<target>/`. Only the `web` target adds `vite-plugin-pwa`. Shared code stays in `src/pages`, `src/features`, `src/entities`, `src/shared`, and `src/i18n`.

## Consequences

- Three dev servers can run at once (ports 5173, 5174, 5175).
- Admin code is only reachable from `src/app/admin/router.tsx`, so it is never in the mobile or web bundle.
- Capacitor `webDir` is `dist/mobile`.
- Vitest uses its own `vitest.config.ts` because the Vite root is not the project root.
- `APP_TARGET=<name>` is a shell environment variable. On Windows use `cross-env` or PowerShell `$env:APP_TARGET`.
- If the apps later need different dependencies or release cycles, the same folder split maps one-to-one onto a monorepo.
