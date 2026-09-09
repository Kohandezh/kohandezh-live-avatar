# ADR 0008 — Monorepo: Frontend and Backend in One Repository

## Status

Accepted. Supersedes the single-package part of ADR 0004.

## Context

ADR 0004 put the three frontend targets in one Node package with one entry folder per target. It
rejected a monorepo because three frontend bundles did not need one, and it noted that the folder
split "maps one-to-one onto a monorepo" if that changed.

It has changed. The backend is now part of the same product (ADR 0006), and keeping it in a second
repository costs more than it saves:

- The API contract lives in `docs/API.md` and the mock in `src/data/mock`. A contract change means
  two pull requests in two repositories that must land together.
- ADR 0007 generates frontend types from the backend's OpenAPI document. That is a build step
  across a repository boundary unless both sides sit together.
- On-premise installs ship the frontend and the API as one bundle. One repository, one version tag.

## Decision

One repository, two applications:

```text
apps/
├── frontend/   Node package: the three targets from ADR 0004
└── api/        Python: FastAPI backend (ADR 0006)
docs/           the contract and the architecture, shared by both
```

ADR 0004 still holds inside `apps/frontend`. `APP_TARGET` still selects the Vite root, and the three
targets are still one Node package. Only the location changed.

`pnpm-workspace.yaml` lists `apps/frontend`, and the root scripts delegate
(`pnpm build` runs `pnpm --filter @app/frontend build`). So the commands documented everywhere
still work from the repository root. The package manager is pnpm (ADR 0009).

`apps/api` is **not** a workspace package. Python has its own dependency file, so a polyglot
monorepo does not need one tool to drive both sides.

## Consequences

- Every frontend path moved under `apps/frontend/`. The configs use `import.meta.dirname` and
  relative paths, so their contents did not change. Build output is now `apps/frontend/dist/<target>/`.
- Capacitor commands run from `apps/frontend`, where `capacitor.config.ts` lives.
- CI still runs every command at the root. Add a separate job when `apps/api` has code.
- Shared documentation stays at the root. A doc that belongs to one app goes in that app's folder.
- A team that wants the frontend alone can copy `apps/frontend` plus `docs/`. Nothing in the
  frontend imports from `apps/api`; the boundary is HTTP.
