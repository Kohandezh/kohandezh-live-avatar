# starter-app

Cross-platform frontend starter: one React + TypeScript codebase that ships as a **PWA** and as
**Android / iOS** apps through Capacitor, talking to an independent backend through a documented
API contract.

```bash
pnpm install
pnpm dev:all        # web http://localhost:5173  ·  mock API http://localhost:8787
pnpm check          # typecheck + lint + format + tests
```

Demo login: `demo@example.com / demo1234`.

| Read this | For |
| --- | --- |
| `CLAUDE.md` | How to work in this repo: setup, commands, structure, patterns |
| `AGENTS.md` | Standing rules: judgment, stop conditions, UI/UX engineering standards |
| `ENGINEERING_CONSTITUTION.md` | The ten non-negotiable principles |
| `docs/engineering/ARCHITECTURE.md` | Full target architecture |
| `docs/api/openapi.yaml` | The API contract the app depends on |

## Layout

```
src/app        bootstrap, providers, router, store, layout
src/pages      route composition
src/features   interactive flows (authentication, …)
src/entities   domain entities + TanStack Query hooks (user, …)
src/shared     api · config · platform · storage · i18n · ui · hooks · utils
src/data       static build-time data
mock-backend   contract-first mock API (never deployed)
docs           engineering docs, ADRs, contract, feature research
```

## Native

```bash
npx cap add android && npx cap add ios   # once
pnpm cap:android   # or pnpm cap:ios
```

## Environments

`.env.development` · `.env.staging` · `.env.production` — only `VITE_*` values, validated at boot
in `src/shared/config`. Source code never changes between environments.
