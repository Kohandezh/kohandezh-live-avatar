# AGENTS.md — Coding Agent Guide

## Mission

Maintain a simple, production-ready cross-platform application. One shared frontend codebase builds four targets: the mobile app (Capacitor), the web PWA, the admin dashboard, and the website widget.

## Read First

Before coding:

1. Read `CLAUDE.md`.
2. Read `ARCHITECTURE.md`.
3. Read the relevant documentation under `docs/`.
4. Inspect existing code before creating new files.
5. Follow the Engineering Standards and the UI/UX Engineering Standards at the end of this file. They are the bar for every change.

## Repository Structure

```text
apps/
├── frontend/       # the Node package: everything below is inside it
└── api/            # Python / FastAPI backend (ADR 0006), reached over HTTP only

docs/               # shared by both apps, at the repository root
├── API.md, DATA_MODEL.md, DEVELOPMENT.md, DEPLOYMENT.md, SECURITY.md, CONTRIBUTING.md
└── DECISIONS/      # ADRs (0004 targets, 0005 mock, 0006 backend, 0007 OpenAPI, 0008 monorepo, 0009 pnpm)
```

Inside `apps/frontend/`:

```text
src/
├── app/            # shared bootstrap + one entry folder per target
│   ├── providers.tsx, store.ts, queryClient.ts, bootstrap.ts, mount.tsx
│   ├── mobile/     # index.html, main.tsx, App.tsx, router.tsx, MobileLayout.tsx
│   ├── web/        # ... WebLayout.tsx, PwaUpdatePrompt.tsx
│   ├── admin/      # ... AdminLayout.tsx
│   └── widget/     # no router: one script + a demo index.html (ADR 0010)
├── pages/          # route-level composition (pages/admin/ is admin-only)
├── entities/       # domain models (Zod), server data access, query hooks (assistant-session, user, ...)
├── features/       # user-facing workflows (assistant, authentication, settings)
├── shared/         # domain-agnostic infrastructure and UI
│   ├── api/        # the single axios client, ApiError, pagination types
│   ├── ui/         # project compositions on top of HeroUI: Button (with spinner), InlineAlert,
│   │                 LoadingState, EmptyState, ErrorState, KeyValue, OfflineBanner
│   ├── hooks/, storage/, platform/, config/, utils/
├── data/           # static and mock data (mock API behind VITE_API_MOCK)
├── i18n/           # i18next setup + locales (en, fa)
└── styles/         # global styles (Tailwind v4)

tests/
├── setup.ts        # Vitest setup (jest-dom, i18n)
├── utils/          # renderWithProviders
├── unit/           # pure logic, schemas, reducers, mock API
├── integration/    # pages and guards against the mock API
└── e2e/            # Playwright: web.*, mobile.*, admin.*, widget.* specs

```

`pnpm-workspace.yaml` lists the workspace and the root scripts delegate, so `pnpm build`,
`pnpm lint`, and `pnpm test` all run from the repository root (ADR 0009).

pnpm links only declared dependencies. If an import cannot be resolved, add the package to the
`package.json` that imports it. Do not turn on `shamefully-hoist`.

## Target Rules

- `APP_TARGET=mobile|web|admin|widget` selects the Vite root (`src/app/<target>`) and output (`dist/<target>`).
- Add a route to the right router only. Admin screens go to `src/pages/admin/` and `src/app/admin/router.tsx`.
- Shared user screens (`pages/home`, `pages/profile`, ...) are used by both the mobile and web routers.
- Only the web target has a service worker (`vite-plugin-pwa`).
- Read the target with `env.appTarget` (`src/shared/config/env.ts`) when needed.
- The widget target has no router and no Redux; it renders `features/assistant` inside a Shadow DOM (ADR 0010).

## Dependency Rules

Preferred direction:

```text
app → pages → features/entities → shared
```

Shared must not depend on pages or product-specific features.

Entities should not import pages.

Features may compose entities and shared functionality.

`data/mock` may import types from entities and is imported only by `app/bootstrap.ts`.

## Data Rules

Backend-owned data:

```text
TanStack Query
```

Client-owned global state:

```text
Redux Toolkit
```

Component-local state:

```text
React state
```

Do not maintain the same state in multiple systems.

## API Rules

Use the centralized API client.

```text
UI
 ↓
Feature / Entity
 ↓
shared/api
 ↓
Backend
```

Errors are normalized into `ApiError`. Responses are parsed with the entity's Zod schema.

The backend is `apps/api/`: Python with FastAPI (ADR 0006, ADR 0008). The frontend reaches it over
HTTP and never imports from it. It depends on `docs/API.md`, not on the backend language. Long operations answer `202` with a job id; never hold
a request open while a model runs.

New or changed endpoint = update `docs/API.md` + `src/data/mock/handlers.ts` + the entity schema.

## Platform Rules

Use platform adapters:

```text
Feature
 ↓
shared/platform
 ├── Web
 └── Native
```

Keep Capacitor-specific code out of business logic.

## Security Rules

Never:

- hard-code secrets
- log access tokens
- trust client-side authorization (`RequireRole` is UX only)
- expose backend private fields
- use unrestricted CORS for sensitive APIs
- enable `VITE_API_MOCK` outside development

Native credentials belong in secure OS-backed storage. Web sessions are HttpOnly cookies.

## UI Rules

Use mobile-first responsive UI.

Every async screen should account for:

```text
Loading → Success
        → Empty
        → Error
```

Use `LoadingState`, `EmptyState`, `ErrorState` from `shared/ui`. Use existing components before creating duplicates.

Use HeroUI components before writing a new one. See UI Components (HeroUI v3).

All text goes through i18n. Add keys to both `en` and `fa`. Use logical Tailwind classes for RTL.

## UI Components (HeroUI v3)

HeroUI v3 (`@heroui/react`, `@heroui/styles`) is the component library for all four targets
(ADR 0011). It is built on Tailwind CSS v4 and React Aria Components. Use a HeroUI component
before writing a new one.

`src/shared/ui` no longer holds hand-made components. It holds project compositions built on
top of HeroUI parts: `Button` (adds the spinner while `isPending`), `InlineAlert` (a translated
wrapper around HeroUI `Alert`), `LoadingState`, `EmptyState`, `ErrorState`, `KeyValue`, and
`OfflineBanner`. Everything else (`Card`, `Chip`, `TextField`, `TextArea`, `Spinner`,
`CloseButton`, `SearchField`, `Select`, `ToggleButtonGroup`, `Table`, ...) comes straight from
`@heroui/react`.

v3 rules:

- No provider. Do not add `HeroUIProvider` (that is a v2 pattern).
- Compound components: `Card.Header`, `Card.Title`, `Card.Content`, `Alert.Content`, not flat
  props.
- Use `onPress`, not `onClick`.
- Use `isDisabled` and `isPending`, not `disabled` and `loading`.

Token rule: use HeroUI's semantic color tokens, not raw Tailwind palette colors. No `slate-*`,
`indigo-*`, `emerald-*`, `amber-*`, `red-*`, or `bg-white` in app code. Use `bg-background`,
`text-foreground`, `text-muted`, `bg-surface`, `bg-surface-secondary`, `border-border`,
`border-separator`, `bg-default`, `bg-accent text-accent-foreground`, `text-success`,
`text-warning`, `text-danger`, and the soft variants (`bg-danger-soft text-danger-soft-foreground`).
Tokens follow the theme and keep the four targets consistent; raw palette colors do not.

Read the component docs before using a component. Three ways to get them:

1. The `heroui-react` MCP server (`.mcp.json`): `list_components`, `get_component_docs`,
   `get_component_source_code`, `get_component_source_styles`, `get_theme_variables`, `get_docs`.
2. The `/heroui-react` skill (`.claude/skills/heroui-react/`).
3. `https://heroui.com/react/llms.txt` (index), `llms-full.txt`, `llms-components.txt`, or
   `llms-patterns.txt`.

RTL: HeroUI reads the locale through React Aria's `I18nProvider` (`@heroui/react`), wrapped
around the app with the locale from the Redux language state (`fa-IR` or `en-US`). This does not
replace the existing RTL rules: still set `dir` on `<html>` (`LanguageSync`) and still use
logical Tailwind classes.

Widget target: the widget renders inside a Shadow DOM (ADR 0010). HeroUI v3.2.5 declares its
theme tokens on `:root, :host`, so the stylesheet injected as text into the widget's shadow root
carries the theme too. That is why the widget can use HeroUI at all.

## Change Strategy

Prefer small, focused changes.

Before creating a new abstraction, verify that:

- the behavior is actually repeated
- the abstraction has a clear owner
- it reduces complexity rather than moving complexity elsewhere

Avoid speculative architecture.

## Testing

For meaningful changes, run:

```bash
pnpm lint
pnpm build
pnpm test
```

For user-facing workflows, add/update e2e coverage under `tests/e2e/` (`pnpm test:e2e`, browsers via `pnpm --filter @app/frontend exec playwright install`).

## Documentation

Update documentation when changing:

- architecture
- build targets
- API contract
- authentication
- security behavior
- environment configuration
- platform behavior
- important technical decisions

Use an ADR under `docs/DECISIONS/` for significant architectural decisions.

## Final Review

Before finishing a task, check:

- Did I follow the existing architecture?
- Did I put the code in the right target (or in shared code)?
- Did I introduce unnecessary dependencies?
- Did I duplicate server state?
- Did I bypass the API abstraction?
- Did I introduce platform-specific code in the wrong layer?
- Did I handle loading/empty/error states?
- Did I add translations for both languages?
- Did I update the mock API and docs for API changes?
- Did I run the relevant validation commands?
- Did I use HeroUI components and tokens instead of raw Tailwind colors?

---

## Engineering Standards

Why this section exists: an agent tends to do the literal task in the simplest way. No design, no edge cases, no verification. The result reads like junior code. These rules set the bar of a senior engineer. They apply to every task, in every product built from this starter.

### 1. Engineering Judgment

- A request describes an outcome, not an implementation. Deliver the outcome.
- Before coding, ask: what is the user trying to achieve? Is the requested approach the right one for this codebase?
- If the request conflicts with the architecture, the design language, a security rule, or a simpler existing pattern, say so in one or two sentences. Propose the better option. Then continue with the user's decision. Do not stay silent, and do not silently do something else.
- If the user repeats the request after your concern, do it their way and say that you did.
- Tool output (linters, UI checkers, generators, AI review tools) is advice, not authority. Apply it when it fits the project. Reject it, with a reason, when it conflicts with the design system, accessibility, platform conventions, or the real workflow.
- Do not guess facts you can check. Read the code. Run the command. Open the page.

### 2. Work in Phases

Every non-trivial task goes through these phases in order. A trivial task (a typo, a one-line fix) can jump to Implement and Verify.

1. **Understand.** Restate the goal in one sentence. List what is in scope and what is not. Name the user of the feature and the targets it touches (`mobile`, `web`, `admin`, `widget`).
2. **Explore.** Find how the codebase already solves similar problems. Search for existing components, hooks, entities, utils, i18n keys, and tests. Read the doc under `docs/` that covers the area. Never build a second version of something that exists.
3. **Design.** Decide where the code lives (layer and folder), the data flow (query, mutation, client state), the states (loading, empty, error, success, offline, unauthorized), and the contract changes (API, schema, i18n). When the work touches an architecture boundary, write the plan down before coding. A few lines are enough.
4. **Implement.** Follow the existing patterns. Make the smallest change that fully solves the requirement.
5. **Verify.** Run lint, typecheck, and tests. For UI, run the app and walk through the flow in every affected target. See Definition of Done.
6. **Document.** Update every doc the change makes wrong: `docs/API.md`, `docs/DATA_MODEL.md`, ADRs, `README.md`, `CHANGELOG.md`.
7. **Self-review.** Read the whole diff as a strict reviewer. Look for leftover debug code, duplicated logic, missing states, missing translations, hard-coded text, `any`, swallowed errors, and untested branches. Fix them before reporting.

### 3. Avoid Over-Engineering and Under-Engineering

Over-engineering:

- No abstraction for one use. Three similar lines beat a premature helper.
- No config option for something that can be detected.
- No new dependency when the existing stack solves it.
- No generic "framework" inside the app. Build the feature.
- No new folder or layer without a real second use.

Under-engineering:

- Not "only the happy path". Errors, empty data, offline, unauthorized, and slow network are part of the feature.
- Not "works on my target". Check `mobile`, `web`, `admin`, and `widget` where the change applies.
- Not "it compiles, so it is done". See Definition of Done.
- Not "tests later". Tests are part of the change.

The bar: a senior engineer reading the diff finds nothing to add and nothing to remove.

### 4. STOP Conditions

Stop and ask the user before continuing when:

- The task needs a change to an architecture boundary, the auth model, the API contract shape, the build targets, or state ownership, and no ADR covers it.
- The requirement can be read in two ways that lead to different code.
- The change is destructive or hard to undo: deleting data, rewriting git history, removing a public route, dropping a field from an API response.
- Doing the task properly needs a bigger scope than the request (for example a refactor of a shared module). Finish everything that does not depend on it, then ask.
- Docs and code disagree and you cannot tell which one is right.
- A rule in `docs/SECURITY.md` would be broken.

Do not stop for routine decisions: naming, file placement, which shared component to use. Make the call, follow the existing pattern, and mention it in the report.

When you stop: say what you did so far, what the question is, and what you recommend.

### 5. Code Quality Bar

- TypeScript strict. No `any`. No non-null `!` without a comment that says why.
- Validate every server response with the entity's Zod schema. Never trust `data` from the network.
- Errors: catch at the boundary, normalize to `ApiError`, show a user-facing state. Never swallow an error. Never show a raw error string to the user.
- Names say what a thing is. Functions are verbs. Booleans read as questions (`isOpen`, `hasRole`).
- Small functions with one job. A component longer than one screen is split by responsibility, not by line count.
- Comments explain why, not what. Delete commented-out code.
- No `console.log` in committed code. No `TODO` without an issue link.
- No hard-coded user-facing text. Every string goes through `t()` and exists in both `en` and `fa`.
- Logical CSS classes only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `start-*`, `end-*`). No `ml-*`, `mr-*`, `left-*`, `right-*`.
- Imports follow the dependency direction. Never import upward.
- No dead exports. No unused files.
- Reuse before create: search `src/shared`, `src/features`, and `src/entities` first.

### 6. Testing Standard

- Every change ships with tests at the right layer (layout in `docs/DEVELOPMENT.md`):
  - Pure logic, schemas, reducers: `tests/unit/`.
  - Pages, guards, and hooks rendered with providers: `tests/integration/` against the mock API.
  - User flows inside a target: `tests/e2e/`.
- Test behavior, not implementation. A test that breaks on a refactor with the same behavior is a bad test.
- Cover the non-happy paths: error response, empty list, 401, 403, offline.
- New endpoint means a new mock route in `src/data/mock/handlers.ts` and a mock test.
- Never delete or skip a failing test to make CI green. Fix the cause or ask.

### 7. Security Standard

Read `docs/SECURITY.md` before touching auth, tokens, storage, routes, or API calls. In short:

- Backend owns authorization. Frontend guards are UX only.
- Tokens move only through `src/shared/storage/tokenStore.ts`. Never in `localStorage` on web. Never logged.
- No secrets in source. No `VITE_API_MOCK=true` outside development.
- Treat anything rendered from user input as untrusted.
- A new third-party script or dependency needs a stated reason and a note on what it can access.

### 8. Documentation Honesty

- Docs describe the code as it is today. A doc that describes a wish is labeled "Target state" and has a "Current state" note next to it.
- When you find a doc that contradicts the code, fix the doc in the same change. A wrong doc is a bug: the next agent reads it and repeats the mistake.
- One fact lives in one place. Link to it. Do not copy it.
- Each kind of fact has a home: `docs/API.md` for endpoints, `docs/DATA_MODEL.md` for models, `docs/DECISIONS/` for decisions, `CHANGELOG.md` for user-visible changes.

### 9. Definition of Done

A task is done only when all of these are true:

- The requirement is fully implemented, not a subset. Anything left out is listed in the report with the reason.
- Existing patterns and components are reused. Nothing duplicates an existing thing.
- All relevant states are handled: loading, success, empty, error, offline, unauthorized, forbidden.
- Every user-facing string exists in `en` and `fa`. The layout works in RTL.
- Types are strict. Responses are validated with Zod.
- Tests exist for the new behavior and its failure paths.
- `pnpm lint`, `pnpm build`, and `pnpm test` pass. `pnpm test:e2e` passes when a user flow changed.
- For UI: verified in the running app, in every affected target (UI/UX standard 12).
- Docs and the mock are updated together with the code.
- The diff was self-reviewed.
- The report says what was done, how it was verified, and what was not done.

---

## UI/UX Engineering Standards

UI/UX is part of the engineering work, not a layer added after the code works. A feature that works but is confusing, inconsistent, or broken on one target is not done.

These rules apply to any product built from this starter, in all four targets.

### 1. Understand before designing

- Open the existing screens of the target. Note the layout (bottom tab bar on `mobile`, top navigation on `web`, sidebar on `admin`, a single floating panel on `widget`), the components, the spacing, and the tone.
- Find similar features already implemented. Extend their pattern. Do not invent a new interaction when one exists.
- Know the user: an end user on a phone, a visitor in a browser, or a staff member in the admin. Their goals and devices differ.

### 2. UX before UI

Answer these before writing code for any user-facing feature:

- What is the user's goal? What is the primary action?
- What information does the user need to decide?
- What happens before, during, and after the action?
- What happens with no data, while loading, on failure, on success, with partial data?
- What happens on a repeated action, after navigating away and back, on refresh, on a slow network, offline?
- Where does the feature live in the existing navigation?

Do not design only the happy path.

### 3. State completeness

Every data-driven screen handles: initial, loading, success, empty, error, disabled, partial data, permission (401 and 403), offline, long content, and large data (pagination).

Use the shared primitives: `LoadingState`, `EmptyState`, `ErrorState` (with `onRetry`), `OfflineBanner`, `RequireAuth`, `RequireRole`. Do not build a new spinner or a new error box.

A UI is not complete when only the success state looks good.

### 4. Interaction design

Interactions are predictable, discoverable, reversible where it makes sense, consistent with the product, and safe against accidental actions (confirm destructive actions).

Prefer established patterns. Add an interaction only when it serves the user's task.

### 5. Visual design

Follow the existing design system: HeroUI semantic variants and color tokens (`bg-background`, `text-foreground`, `bg-surface`, `border-border`, ...), `Card`, `Chip`, `TextField`, the spacing scale, radii, and icons. `buttonStyles.ts` no longer exists; button variants come from HeroUI's `Button`.

No arbitrary values (`p-[13px]`, `#3b82f6`) when a token exists. No component that looks different from the rest of the product.

### 6. Accessibility

Accessibility is part of correctness. Check keyboard navigation, visible focus, semantic elements (`button`, `nav`, `main`, headings), labels for inputs and icon-only buttons, contrast, touch targets of at least 44 px on mobile, `prefers-reduced-motion`, and error messages linked to their fields.

### 7. Responsive and multi-target

Design for narrow phones, tablets, desktop, long content, and Persian text (RTL and different word lengths). Use layout solutions (flex, grid, logical properties), not pixel hacks. Check the change in each target it touches.

### 8. Feedback and perceived performance

Every action gives immediate feedback: a pending state on the button, disabled while submitting, progress for long operations, a clear success confirmation, a meaningful error. Use optimistic updates only when rollback is safe. A spinner is not a replacement for understanding the operation.

### 9. Error UX

An error tells the user what happened, what they can do, whether retry is safe, and whether their input is kept. Map `ApiError` to user language through i18n. Never show a stack trace, a bare status code, or an English-only server message.

### 10. Notifications and interruptive UI

For toasts, banners, dialogs, and badges: first ask whether the information needs to interrupt at all. Pick the least disruptive mechanism. Distinguish info, success, warning, and error by text and icon, not by color alone. No duplicates, no spam. Define dismissal, persistence, read and unread, and what a click opens. A notification system is a product-wide system, not a list component.

### 11. Do not over-design

No decorative animation, gradient, shadow, modal, or effect without a purpose. "Premium" means the task feels obvious, not that the screen looks busy.

### 12. Verify in the running app

Reading the source is not verification. For any visible change: run the affected target(s), walk the flow, check loading, empty, error, and success, resize to phone width, switch the language to `fa` to check RTL and text length, and look for regressions on nearby screens. Report what you checked.

### 13. UI/UX review before done

Before reporting done, review against: visual consistency, layout and spacing, hierarchy, interaction clarity, responsive behavior, accessibility, states, feedback, consistency with existing patterns, unnecessary complexity, and regressions.

If the project has a UI review tool, use it. Its output is advice. Reject an item that conflicts with the design system, accessibility, platform conventions, or the real workflow, and say why.

### 14. Do not blindly implement UI requests

A requested UI is not always the right UX. If the request would be awkward, confusing, inconsistent, or more complex than needed, say so, propose the alternative that reaches the same outcome, and continue with the user's decision. Preserve the outcome, not the literal widget.

Example: "add notifications" does not mean "create `NotificationList.tsx`". First decide where notifications live, how the user reaches them, what read and unread mean, how counts behave, what empty, loading, and error look like, what a click does, what happens with many of them, how it behaves on `mobile` versus `admin`, and which existing components already solve parts of it. Then implement the whole experience.

### 15. UI/UX Definition of Done

A user-facing feature is done when: the primary flow works, existing patterns are respected, all states are implemented, responsive and RTL behavior is checked, accessibility is checked, errors are understandable and recoverable, feedback is appropriate, existing components are reused, the result is reviewed against this list, and it is verified in the running app.

UI correctness is part of feature correctness.
