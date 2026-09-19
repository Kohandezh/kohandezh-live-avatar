---
name: code-review
description: >
  Review submitted code changes like a senior engineer on this repo: React/TypeScript and
  FastAPI correctness, the layer boundaries, authorization and session handling, Zod validation
  of every response, the four build targets, i18n and RTL, the required UI states, test
  coverage, and the simplicity bar, with severity-prioritized findings. Use whenever the user
  asks for a code review, a PR review, a security-focused review, or wants feedback on changes
  before merging.
---

# Code Review

Code review is the gate before any PR merges into this repo. Every scoped PR passes through a review after the `commit` skill and before merge. For stacked PRs, review each slice on its own, bottom slice first. The `merge-stacks` skill covers merge order.

This skill is the working method. The diff under review is the source of truth, not the broader codebase. **Scope the review to the PR's own root cause.** Unrelated code in the same files is out of scope unless the PR touched it.

The repo's own documents decide what "correct" means here, in this order:

- `AGENTS.md` (Engineering Standards and UI/UX Engineering Standards, the Definition of Done, the STOP conditions)
- `CLAUDE.md` (targets, layers, state ownership, the Do Not list)
- `ARCHITECTURE.md` and `docs/DECISIONS/` (why the boundaries are where they are)
- `docs/SECURITY.md` (sessions, one-time codes, secrets, the widget embed model)
- `docs/API.md` (the contract) and `docs/DATA_MODEL.md`
- `docs/DEVELOPMENT.md` and `docs/TEST_PLAN.md` (which test goes at which layer)

When a doc and the code disagree, that is a finding in itself: say which one you believe is wrong (`AGENTS.md`, Documentation Honesty).

## The process

### 1. Establish the exact diff

Decide BASE and HEAD before reading a single file:

```bash
BASE_SHA=$(git merge-base origin/main HEAD)
HEAD_SHA=$(git rev-parse HEAD)
git diff --stat "$BASE_SHA".."$HEAD_SHA"
git diff "$BASE_SHA".."$HEAD_SHA"
```

The default branch is `main`. For a stacked PR, use the parent slice's tip as BASE instead of `origin/main`. `gh stack view` shows the chain and which branch sits below this one.

Review only what the diff shows. Do not change the working tree, the index, HEAD, or branch state during a review. Inspect with `git diff`, `git show`, and `git log` only.

### 2. Read the PR description

Understand the stated root cause before judging the code. A deviation from the stated intent is a finding. A change in the diff that the description never mentions is a yellow flag worth naming.

### 3. Check CI

CI on GitHub is the merge gate. Read the real result rather than guessing:

```bash
gh pr checks <number>          # per-job status for the PR
gh run list --branch <branch> --limit 1
gh run view <run-id> --log-failed
```

Three jobs run and all three block (`.github/workflows/ci.yml`): `frontend` (typecheck, lint, test, build, `./scripts/check-frontend-secrets`), `e2e` (Playwright over the four targets), and `backend` (pytest under Compose). A red blocking job is a Critical finding by itself. On a red `e2e`, `gh run download <run-id> -n playwright-report` gives the real failure instead of a guess.

Running `pnpm lint && pnpm build && pnpm test` locally is cheap and worth doing on a large diff. It is a supplement to CI, not a replacement.

### 4. Assess against these disciplines

Work through each one that the diff touches. Every finding needs a file:line reference, what is wrong, why it matters, and how to fix it.

#### Layer boundaries and target placement

The dependency direction is `app → pages → features/entities → shared → platform/api/storage`. Nothing imports upward.

1. **No reverse dependency.** `shared/` importing a feature or a page is a finding. `entities/` importing a page is a finding. `shared/` holding product-specific business logic is a finding: it must stay domain-agnostic.
2. **Right target.** Admin pages live in `src/pages/admin/` and are imported only by `src/app/admin/router.tsx`. An admin page reachable from the mobile or web router is a Critical finding: it ships staff screens to end users.
3. **The widget has no router and no Redux.** A widget-reachable component pulling in `react-router-dom` or `useSelector` breaks that target (ADR 0010).
4. **No service worker in the mobile target.** Only `web` gets `vite-plugin-pwa`.
5. **Target versus platform.** `env.appTarget` answers "which build is this". `src/shared/platform` answers "is this running inside Capacitor". Using one for the other's question is a finding, and so is reading `import.meta.env` directly in feature code.
6. **Capacitor plugins stay behind `src/shared/platform`.** A Capacitor import in a page or in domain logic needs a written reason.

#### State ownership

- **Server data goes through TanStack Query.** The same data also held in Redux is a finding, even when both copies agree today (`CLAUDE.md`, "Do not put server state in Redux").
- **Redux is for client-owned global state only**: theme, language, UI state, filters, temporary workflows. State that only one screen needs belongs in React state.
- Query keys come from the entity's `keys` object. An inline key string that cannot be invalidated is a finding.

#### API access and validation

- **One client.** Every request goes through `src/shared/api`. A direct `fetch` or `axios` call in a page, feature, or component is a finding, and a second client is a Critical one.
- **Zod on every response.** `data` from the network is parsed with the entity's schema before it reaches the UI. An unparsed response, or a `as SomeType` cast standing in for validation, is a finding.
- **Errors normalize to `ApiError`** (`src/shared/api/errors.ts`) and surface as a user-facing state. A swallowed error, a bare `catch {}`, or a raw server string rendered to the user is a finding.
- **Contract changes move together.** A new or changed endpoint updates `docs/API.md`, `src/data/mock/handlers.ts`, and the entity schema in the same PR. A missing one is Important.
- **Long work answers 202 with a job id.** A request held open while a model runs is a finding (`AGENTS.md`, API Rules).

#### Authorization, sessions, and secrets

Read `docs/SECURITY.md` before judging anything in this group.

1. **The backend owns authorization.** `RequireAuth` and `RequireRole` are UX only. A PR that adds an admin capability and relies on the frontend guard for it is Critical. Every `/api/admin/*` handler checks the role on the server.
2. **Tokens move only through `src/shared/storage/tokenStore.ts`.** A token in `localStorage` on web, a token in Redux, a token in a URL, or a token in a log is Critical. Web keeps the session in the HttpOnly `kd_session` cookie; native keeps the same opaque token in OS-backed secure storage and sends it as `Authorization: Bearer`.
3. **The assistant session token is per-conversation, not a login.** The browser SDK holds it in memory only. Putting it in Redux, `localStorage`, a URL, or a log is Critical (`docs/SECURITY.md`, rule 16).
4. **Rate limits and the embed model.** A change that weakens the OTP limits (one code per minute, five per hour per phone, twenty per hour per IP, five wrong codes lock the number) or the widget model (exact `Origin` match against `ASSISTANT_EMBED_ALLOWED_ORIGINS`, per-address session cap) is Critical.
5. **`devCode` stays development-only.** It requires `APP_ENV=development` **and** `OTP_DELIVERY=console`. Any loosening is Critical.
6. **No secrets in the frontend.** Only `VITE_*` reaches the browser and all of it is public. A server secret named anywhere under `apps/frontend` fails `./scripts/check-frontend-secrets` and is Critical.
7. **`VITE_API_MOCK` never leaves development.** The mock signs a visitor in with no credential check.
8. **New auth mechanisms need an ADR first.** A hand-rolled token or cookie scheme inside a handler or a hook is a finding.
9. **Uploads** enforce a maximum size and a content-type allowlist on the server. A client-side check is a hint, not a control.

#### Backend (apps/api)

- Request bodies are Pydantic models in `schemas.py`, not raw dicts.
- The error body stays consistent with the app it belongs to: the orchestrator's enveloped `{ "error": { code, message, retryable, details }, "correlation_id" }` shape, normalized on the frontend by `toApiError`.
- **Migrations are append-only.** A schema change is a new numbered file in `apps/api/services/orchestrator/migrations/`, applied in order on startup. **Editing a migration that has already run anywhere is Critical.** The fix is a new file.
- Unbounded reads paginate. A `SELECT` over a growing table with no `LIMIT` is a finding whatever the current row count is.
- Secrets come from the runtime environment, never from a container image or a build artifact.
- Public responses use explicit field allowlists (`public_user`), never the raw row.

#### User-facing changes: states, i18n, RTL, accessibility

The UI/UX Engineering Standards in `AGENTS.md` are the bar, not a suggestion.

1. **Every async screen handles loading, success, empty, and error**, plus offline, 401 and 403, and partial data where they apply. A PR where only the success state looks right is Important. Use `LoadingState`, `EmptyState`, `ErrorState` (with `onRetry`), `OfflineBanner`. A new hand-made spinner or error box when one of these exists is a finding.
2. **HeroUI v3 first.** New components come from `@heroui/react`; `src/shared/ui` holds project compositions only. Watch for v2 patterns that do not work here: `HeroUIProvider`, flat props instead of compound components, `onClick` instead of `onPress`, `disabled`/`loading` instead of `isDisabled`/`isPending`.
3. **Semantic colour tokens only.** `bg-background`, `text-foreground`, `text-muted`, `bg-surface`, `border-border`, `text-danger` and friends. A raw palette class (`slate-*`, `indigo-*`, `bg-white`) or an arbitrary value (`p-[13px]`, `#3b82f6`) where a token exists is a finding.
4. **Logical CSS only.** `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `start-*`, `end-*`. A `ml-*`, `mr-*`, `left-*` or `right-*` breaks Persian and is a finding.
5. **Every string goes through `t()`**, with the key added to both `src/i18n/locales/en` and `fa`. A hard-coded string, or a key present in only one language, is a finding.
6. **Accessibility is correctness.** Keyboard reachable, visible focus, semantic elements, a label on every input and icon-only button, a touch target of at least 44px on mobile, `prefers-reduced-motion` respected.
7. **Every affected target was checked.** A change to a shared page affects both `mobile` and `web`. The description should say which targets were walked and that `fa` was checked. A visible change with no evidence of that is Important.
8. **Do not over-design.** A decorative animation, gradient, shadow, or modal with no purpose is a finding.

#### Tests

- New behavior needs a test that fails when the change is removed. A new route handler, hook, or guard with no test is a finding.
- Right layer: pure logic, schemas and reducers in `apps/frontend/tests/unit/`; pages, guards and hooks with providers against the mock API in `tests/integration/`; user flows in `tests/e2e/` (Playwright, TypeScript); backend in `apps/api/services/<service>/tests/` (pytest).
- **Cover the non-happy paths**: error response, empty list, 401, 403, offline. A test suite that only proves the happy path is Important.
- A new endpoint needs a new route in `src/data/mock/handlers.ts` and a test against it.
- A test that breaks on a behavior-preserving refactor is testing implementation, and that is a finding.
- A skipped, `xfail`, or deleted failing test added by the PR without a written reason is a finding. Never make CI green by removing a test.

#### Simplicity, duplication, and the STOP conditions

- **A business rule has one implementation.** The same validation or authorization copied into a second place is a finding, even when both copies are correct today.
- **Reuse before create.** A new component, hook, or util that duplicates something in `src/shared`, `src/features`, or `src/entities` is a finding.
- **No abstraction for one use.** A generic helper, a config option for something detectable, a new folder or layer with no second use: all findings (`AGENTS.md`, standard 3).
- **No new dependency** where the existing stack solves it. A new dependency needs a stated reason in the PR and a note on what it can access.
- Watch for the STOP conditions in the diff: a boundary moved with no ADR, a new special case papering over an abstraction, a bypassed validation, a second way to do something that already has one.

#### Code quality

- TypeScript strict. No `any`. No non-null `!` without a comment saying why.
- Names say what a thing is; functions are verbs; booleans read as questions.
- Comments explain why, not what. No commented-out code, no `console.log`, no `TODO` without a link.
- No dead exports, no unused files.

#### Functionality and edge cases

- Does the code do what the description says?
- Are empty, `null`, and malformed values handled? Are error paths deliberate?
- Repeated action, navigate away and back, refresh, slow network, offline: are they handled or only assumed?

### 5. Assign severity

- **Critical**: security hole, data loss, auth bypass, a token in the wrong place, an admin page on a user router, an edited migration that has already run, a second API client, a red blocking CI job, a broken user path. Must be fixed before merge.
- **Important**: missing test for new behavior, a missing non-happy state, a missing translation, server state duplicated in Redux, an unvalidated response, an unbounded query, a contract change with no doc or mock update, a target not checked. Should be fixed before merge.
- **Minor**: naming, a magic number, dead code, a doc line now out of date, a token that could be more precise. Note it. It does not block merge.

Not every issue is Critical. Over-severity destroys trust in the whole review.

### 6. Deliver the review

**Strengths.** What is done well, with file:line. Accurate praise makes the rest credible.

**Issues**, grouped Critical / Important / Minor. Each one:

- `file:line`
- what is wrong
- why it matters
- how to fix it (unless obvious)

When a finding is about **shape** rather than a line (a call path that should not exist, a layer boundary in the wrong place, a state machine missing a branch), a small `text` or `diff` sketch carries it better than a sentence. The `show-me` skill owns the form. GitHub renders these in a PR comment. At most one per finding, and only where prose is losing.

**Assessment**, one of:

- `Ready to merge`: no Critical or Important issues
- `Merge with fixes`: only Minor issues left after the Important ones are addressed
- `Do not merge`: at least one unresolved Critical

Add one or two sentences of technical rationale.

### 7. Act on feedback

- **Critical**: fix before any further work on the branch.
- **Important**: fix before opening the PR or marking it ready.
- **Minor**: fix alongside, or record it in `docs/features/<slug>/` or a Linear issue.
- **Disagreement**: push back with code, a test, or a doc line as evidence. A clear counter-argument is valid. "I will do it later" is not.

## Going deeper

Escalate when the diff is large, touches auth, or changes the database:

- The `.claude/agents/code-review-specialist.md` agent runs this same checklist as a separate pass with its own context. Use it for a second opinion on a big diff.
- The `.claude/agents/security-vulnerability-scanner.md` agent for an auth, session, token, or upload change.
- `/security-review` before calling any access-control change done.
- `/code-review ultra` is the deepest pass (this skill plus both agents). It is **user-triggered only**. Do not invoke it on your own.

## The quality bar

A review is doing its job when it covers only the diff's root cause, every finding cites file:line, severity is calibrated (no inflated Criticals, no buried real ones), the authorization chain is checked on every endpoint the PR touches, every affected target is considered, the assessment is unambiguous, and the author can act on every finding without asking a follow-up question.

## References

- `AGENTS.md` (Engineering Standards 1-9, UI/UX Engineering Standards 1-15)
- `CLAUDE.md` (targets, layers, state ownership, the Do Not list)
- `ARCHITECTURE.md` and `docs/DECISIONS/` (0004 targets, 0010 widget, 0011 HeroUI)
- `docs/SECURITY.md` (sessions, one-time codes, secrets, widget embed model)
- `docs/API.md`, `docs/DATA_MODEL.md` (the contract)
- `docs/DEVELOPMENT.md`, `docs/TEST_PLAN.md` (test layers)
- `apps/frontend/src/shared/api/` (the single client, `ApiError`)
- `apps/frontend/src/shared/storage/tokenStore.ts` (the only token path)
- `apps/frontend/src/features/authentication/guards.tsx` (`RequireAuth`, `RequireRole`, UX only)
- `apps/api/README.md` (error shape, sessions, CORS, long work)
- `../merge-stacks/SKILL.md` (landing stacked PRs after review passes)
