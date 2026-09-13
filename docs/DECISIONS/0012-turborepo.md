# 0012. Turborepo

## Context

The repository is a monorepo containing a FastAPI Python backend and a React frontend. The frontend codebase supports multiple build targets (mobile, web, admin, widget), each with their own dev server and build processes.

We currently use a basic `pnpm` workspace setup (ADR 0009). The `pnpm` filter syntax (`pnpm --filter`) works for delegating commands from the root `package.json` to the frontend package, but doesn't provide caching for intermediate build steps or advanced task orchestration. 

## Decision

We have adopted **Turborepo** (`turbo`) as our build system and task orchestrator for the Node packages in the workspace.

## Consequences

- **Task Caching**: Turborepo caches the output of tasks like `build`, `lint`, and `test`. Subsequent runs of these tasks will complete almost instantly if the source files haven't changed.
- **Orchestration**: The root `package.json` now delegates to `turbo run <task>` rather than manual `pnpm --filter` commands.
- **Flags need `--`**: `turbo run` parses everything after the task name as its own options.
  A flag for the underlying tool has to be pushed past it (`pnpm test -- --reporter=verbose`).
  A bare `pnpm test --run` fails with a `turbo run` usage dump and no tests run at all. Because of
  this, per-package scripts should carry the flags they always need: `@app/frontend`'s `test` is
  `vitest run`, so the documented command stays `pnpm test`. Do not put a runner flag in the root
  script either: `turbo run test -- --run` would send `--run` to every package's test task, and
  `apps/api` runs pytest.
- **`turbo.json`**: A pipeline configuration is maintained at the root of the repository, mapping out task dependencies and outputs (e.g. `dist/**`).
- **Future-proofing**: As we potentially extract shared frontend code (like UI components, config, or utilities) into separate packages within `apps/` or `packages/`, Turborepo will automatically handle dependency graphing and parallelize the build process.
