---
name: software-architecture
description: Use when writing code, designing a feature, or making an architectural decision in this repo (React/TypeScript frontend with four build targets, FastAPI backend, pnpm monorepo). Routes you to the authoritative doc, gives the decision procedure for where code goes and which state system owns it, and covers when a change needs an ADR and when to stop and ask.
---

# Software Architecture

This skill is the **decision procedure**. It does not restate the architecture: the repo
already owns that, and one fact living in two places is how docs go stale.

Read the source before you code, not after.

## The authority order

| Question | Read |
| -------- | ---- |
| What is the shape of the system? | `ARCHITECTURE.md` |
| What are the project rules and the workflow? | `CLAUDE.md` |
| What is the quality bar for a change? | `AGENTS.md` (Engineering Standards 1-9, UI/UX 1-15) |
| Why is a boundary where it is? | `docs/DECISIONS/` (ADR 0001 to 0013) |
| What is the contract? | `docs/API.md`, `docs/DATA_MODEL.md` |
| What are the security rules? | `docs/SECURITY.md` |
| Where does a test go? | `docs/DEVELOPMENT.md`, `docs/TEST_PLAN.md` |
| How is it deployed? | `docs/DEPLOYMENT.md` |
| What does the backend look like? | `apps/api/README.md` |

When two of these disagree, the more specific rule wins **and the disagreement is a doc
bug you fix in the same change** (`CLAUDE.md`). A wrong doc is worse than a missing one:
the next agent reads it and repeats the mistake.

## The shape, in one screen

Two apps in one pnpm workspace (ADR 0008, ADR 0009), reached over HTTP, never imported:

```text
apps/frontend/   React + TypeScript + Vite. One codebase, four builds.
apps/api/        Python + FastAPI (ADR 0006). PostgreSQL 16 + Redis.
```

Four targets from one frontend codebase (ADR 0004, ADR 0010):

```text
mobile   Android/iOS via Capacitor      src/app/mobile   dist/mobile
web      installable PWA                src/app/web      dist/web
admin    staff dashboard                src/app/admin    dist/admin
widget   embeddable script, Shadow DOM  src/app/widget   dist/widget
```

Frontend layers, and nothing imports upward:

```text
app → pages → features/entities → shared → platform/api/storage
```

That is the whole map. Everything else is in `ARCHITECTURE.md`.

## Decision 1: where does this code go?

Ask in this order and stop at the first yes.

1. **Is it domain-agnostic infrastructure?** (an HTTP concern, a storage adapter, a
   generic hook, a UI composition) → `src/shared/`. It must not know about the product.
2. **Is it a domain concept and its server data?** (a model, its Zod schema, its API calls,
   its query hooks with a `keys` object) → `src/entities/<name>/`.
3. **Is it a user-facing workflow?** (authentication, the assistant, settings, recording)
   → `src/features/<name>/`.
4. **Is it route-level composition?** → `src/pages/`. Admin screens go to
   `src/pages/admin/` and are imported **only** by `src/app/admin/router.tsx`.
5. **Is it the shell of one target?** → `src/app/<target>/`. Those folders hold only
   `index.html`, `main.tsx`, `App.tsx`, `router.tsx`, and a layout.
6. **Does it talk to the device?** → behind `src/shared/platform/`. Capacitor plugins do
   not reach pages or domain logic.
7. **Is it backend work?** → `apps/api/services/<service>/`. It reaches the frontend only
   through `docs/API.md`.

If none of these fit, that is a STOP condition. Do not invent a layer to make it fit.

## Decision 2: which system owns this state?

| The data is | It lives in |
| ----------- | ----------- |
| owned by the server | TanStack Query, keyed by the entity's `keys` object |
| client-owned and global (theme, language, UI state, filters, a temporary workflow) | Redux Toolkit |
| needed by one screen | React state |

**Never two of these at once.** Server data mirrored into Redux is the most common version
of this mistake, and it is a `Do Not` in `CLAUDE.md`.

The widget has no Redux at all (ADR 0010). Code that could be reached from the widget must
not call `useSelector`.

## Decision 3: target or platform?

Two different questions, and mixing them causes real bugs:

- **Which build is this?** → `env.appTarget` from `src/shared/config/env.ts`. Never read
  `import.meta.env` in feature code.
- **Is this running inside Capacitor?** → `src/shared/platform`.

A web build can run in a browser. A mobile build always runs native. They are not the same
axis.

## Decision 4: does this need an ADR?

Write one in `docs/DECISIONS/` when the change decides something a later reader would
otherwise have to reverse-engineer, and would plausibly "fix" by accident:

- a folder or layer boundary moves
- the auth model changes
- a build target is added or removed
- state ownership changes
- a new third-party dependency with real reach
- a deliberate exception to a house rule

ADR 0013 is the clearest example: the conversation controls are anchored to physical screen
positions and do **not** mirror in RTL, against the house rule. Without the ADR, every
reviewer reads `left` in a bilingual app, assumes somebody forgot, and "fixes" it. The ADR
exists to stop that change.

Follow the numbering and the shape of the existing files. Keep it short: context, decision,
consequences.

## Decision 5: contract changes move together

A new or changed endpoint is one PR across both apps (`docs/CONTRIBUTING.md`):

```text
apps/api/...                            the handler and its Pydantic schema
docs/API.md                             the contract
apps/frontend/src/entities/<x>/types.ts the Zod schema
apps/frontend/src/data/mock/handlers.ts the mock route
tests on both sides
```

Missing one of those is not a small omission. The frontend validates every response with
Zod, so a contract that drifts turns into a runtime parse failure, not a type error.

Long work answers `202` with a job id and the client polls. Never hold a request open while
a model runs.

## The workflow

`AGENTS.md` "Work in Phases" is the required order: Understand, Explore, Design, Implement,
Verify, Document, Self-review. The `implement` skill drives it.

Two things that are skipped most often and cost most:

- **Explore before you build.** Search `src/shared`, `src/features`, and `src/entities`
  first. Never build a second version of something that exists.
- **Verify in the running app.** For any visible change, start the target from
  `.claude/launch.json`, walk the flow, check every state, check phone width, switch to
  `fa`. Reading the source is not verification.

## STOP and ask

From `AGENTS.md` section 4. Stop before continuing when:

- the task needs a change to a layer boundary, the auth model, the API contract shape, the
  build targets, or state ownership, **and no ADR covers it**
- the requirement can be read two ways that lead to different code
- the change is destructive or hard to undo
- doing it properly needs a bigger scope than the request
- docs and code disagree and you cannot tell which is right
- a rule in `docs/SECURITY.md` would be broken

Do not stop for routine decisions: naming, file placement, which shared component to use.
Make the call, follow the existing pattern, and say so in the report.

When you do stop: say what you did so far, what the question is, and what you recommend.

## Anti-patterns to catch in your own diff

- A reverse dependency (`shared/` importing a feature, `entities/` importing a page).
- An admin page reachable from the mobile or web router.
- A second API client, or a `fetch`/`axios` call outside `src/shared/api`.
- A response used without its Zod schema.
- A token anywhere but `src/shared/storage/tokenStore.ts`.
- A generic abstraction built for one use.
- A new dependency where the existing stack already solves it.
- A service worker in the mobile target.
- A config option for something the code can detect by itself.
