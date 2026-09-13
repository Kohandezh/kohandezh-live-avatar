# ADR 0009 — pnpm as the Package Manager

## Status

Accepted

## Context

The repository is a monorepo with a Node application and a Python application (ADR 0008). The Node
side needs a package manager. npm worked, but two of its behaviours cost us:

- **Flat `node_modules` hides missing dependencies.** Any package can import any transitive
  dependency, so code compiles locally and breaks for someone whose tree resolves differently.
- **Disk and install time.** Every install copies the full tree.

## Decision

Use pnpm. `pnpm-workspace.yaml` lists the workspace packages; the root scripts delegate with
`pnpm --filter @app/frontend <script>`.

`packageManager` in the root `package.json` pins the version, so `corepack` gives everyone the same
pnpm without a separate install step.

## Consequences

- **Undeclared dependencies now fail.** pnpm links only what a package declares. Switching found one
  immediately: `vite-plugin-pwa` generates a virtual module that imports `workbox-window`, which the
  app had never declared. It only worked because npm flattened it into reach. It is now an explicit
  `devDependency`. Expect this the next time a plugin injects an import.
- **Install scripts are blocked by default.** pnpm 10 does not run a dependency's postinstall unless
  it is listed. `esbuild` needs its own to place the platform binary, so `onlyBuiltDependencies` in
  `pnpm-workspace.yaml` allows exactly that one. Add to that list deliberately, never in bulk.
- **`shamefully-hoist` is not the fix.** If a package cannot find something, declare the dependency.
  Turning hoisting on gives back the exact problem this ADR is here to remove.
- Everyday commands change shape: pnpm forwards extra arguments to a script without npm's `--`,
  and `pnpm --filter @app/frontend exec <tool>` runs a workspace binary. (Superseded in part by
  ADR 0012: the root scripts now call `turbo run`, so a tool's own flags need `--` again.)
- CI installs with `--frozen-lockfile`, which fails when `pnpm-lock.yaml` and `package.json`
  disagree. That is the point: a lockfile that drifts should stop the build.
- Contributors need pnpm. `corepack enable pnpm` is enough.
