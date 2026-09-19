---
name: implement
description: Full Research → Plan → Implement → Verify workflow for features, refactors, or bugfixes. Use when asked to implement, build, refactor, or make a non-trivial change that benefits from structured phases.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(pnpm *) Bash(npx *) Bash(python3 *) Bash(pytest *) Bash(docker compose *) Bash(cat *) Bash(ls *) Bash(find *) Bash(grep *) Bash(sed *) Bash(curl *) Read Edit Write Grep Glob Agent
argument-hint: "[description of what to implement or refactor]"
---

# Implement: $ARGUMENTS

You are executing a structured 4-phase implementation workflow for: **$ARGUMENTS**

Complete each phase fully before moving to the next. After each phase, output a clear **phase summary** before proceeding.

---

## Current Context

- **Branch:** !`git branch --show-current`
- **Changed files:** !`git diff --name-only`
- **Recent commits:** !`git log --oneline -5`

---

## Phase 1: Research

> Goal: Understand before you act.

1. **Read the rules first** — `CLAUDE.md` and `AGENTS.md` are already in context. Read `ARCHITECTURE.md` and the doc under `docs/` that covers the area before anything that touches a boundary.
2. **Search the codebase** — Use Grep and Glob to find every file relevant to "$ARGUMENTS". Cast a wide net first, then narrow. Search `src/shared`, `src/features`, and `src/entities` before creating anything: reuse before create.
3. **Read key files** — Understand existing patterns, imports, naming conventions, and architecture. Follow the code's style.
4. **Name the targets** — Which of `mobile`, `web`, `admin`, `widget` does this touch? Which layer does the code belong to (`app → pages → features/entities → shared`)?
5. **Check dependencies** — Frontend deps live in the `package.json` that imports them; backend deps in `apps/api/services/orchestrator/requirements.txt`. Do not add a dependency before checking whether the existing stack solves it.
6. **Check the contract** — If an endpoint is involved, read `docs/API.md`, the entity's Zod schema, and `src/data/mock/handlers.ts`. All three change together.
7. **Check tests** — Find existing tests in `apps/frontend/tests/{unit,integration,e2e}` and `apps/api/services/*/tests`. Understand the patterns used.
8. **Check i18n** — Find the existing keys in `src/i18n/locales/en` and `fa` rather than inventing new ones.
9. **External context** — For a library or SDK question, use Context7 rather than memory. For HeroUI, use the `heroui-react` skill or the `heroui-react` MCP server.

**Exit criteria:** You can name every file that will need to change, which target and layer it belongs to, and why.

Output:
```
### RESEARCH SUMMARY
- **Files found:** <list>
- **Architecture understanding:** <brief>
- **Patterns to follow:** <naming, style, error handling>
- **Existing tests:** <relevant test files>
- **External dependencies:** <any>
- **Files that will need changes:** <list with reasons>
```

---

## Phase 2: Plan

> Goal: Design before you code.

Based on the research, create a concrete plan:

1. **List every file** you will create or modify — with a one-line description of what changes in each.
2. **Order of changes** — Sequence them to avoid breaking intermediate states. Dependency-safe order. Backend and contract first, then frontend, when both move.
3. **Data flow** — Server state goes through TanStack Query, client-owned global state through Redux, everything else stays local React state. Say which, and do not duplicate state across systems.
4. **States** — For a user-facing change, list loading, success, empty, error, offline, 401 and 403, and partial data, and name the shared primitive that covers each (`LoadingState`, `EmptyState`, `ErrorState`, `OfflineBanner`, `RequireAuth`, `RequireRole`).
5. **Identify risks** — Shared state, migrations, backward compatibility, RTL, edge cases, and which of the four targets could regress.
6. **Contract and docs** — Name the doc changes the code will make necessary: `docs/API.md`, `docs/DATA_MODEL.md`, an ADR under `docs/DECISIONS/`, `CHANGELOG.md`.
7. **Tests to write/update** — Specify what tests are needed and at which layer.
8. **Check the STOP conditions** in `AGENTS.md` section 4. Ask now if one applies, not after the code is written.

**Exit criteria:** Every file, every state, every test, and every risk is covered.

Output:
```
### IMPLEMENTATION PLAN
| Step | File | Action | Description |
|------|------|--------|-------------|
| 1    | ...  | Create/Modify | ... |
| ...  | ...  | ...    | ... |

**Risks:** <list>
**Tests:** <what to add/update>
**Order rationale:** <why this sequence>
```

**IMPORTANT:** Do NOT start coding. Wait for user acknowledgment before proceeding to Phase 3.

---

## Phase 3: Implement

> Goal: Execute the plan precisely.

Execute the plan step by step:

1. **Follow the plan order** — Make changes in the exact sequence from Phase 2.
2. **Match existing conventions** — Use the naming, style, and patterns discovered in Phase 1. Write code that reads like the surrounding code.
3. **Use HeroUI and the tokens** — Build screens from `@heroui/react`, compose from `src/shared/ui`, and use semantic colour tokens. No raw palette classes. Use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`) so RTL works.
4. **Translate as you go** — Every user-facing string goes through `t()` and gets a key in both `en` and `fa`. Never hard-code text.
5. **Validate responses** — Parse every server response with the entity's Zod schema. Errors normalize to `ApiError`.
6. **Keep the contract in sync** — An endpoint change edits `docs/API.md` and `src/data/mock/handlers.ts` in the same step as the code.
7. **Small atomic edits** — Use Edit for targeted changes, Write for new files. Verify each edit is correct.
8. **Keep commits atomic** — After each logical unit of work, suggest a commit (but **only commit if the user explicitly asks**; see the `commit` skill).
9. **Handle surprises** — If you discover something unexpected, pause and inform the user before deviating from the plan.

**Exit criteria:** All code changes are complete and saved.

Output:
```
### IMPLEMENTATION SUMMARY
- **Files created:** <list>
- **Files modified:** <list>
- **Lines added/removed:** <approximate>
- **Deviation from plan:** <any, and why>
```

---

## Phase 4: Verify

> Goal: Prove it works.

Confirm the implementation is correct:

1. **Checks (mandatory)** — Run the gates from `docs/CONTRIBUTING.md`:
   ```bash
   pnpm lint
   pnpm build      # type-checks and builds all four targets
   pnpm test
   ```
   Backend changed as well:
   ```bash
   docker compose run --rm orchestrator pytest -q
   ```
   A user flow changed: `pnpm test:e2e`. Anything under `apps/frontend` or `.env.example` changed: `./scripts/check-frontend-secrets`.
2. **Run the new tests** — Confirm the test you added fails without the change and passes with it. Report results honestly, including failures.
3. **Manual verification (mandatory for any visible change)** — Start the affected target from `.claude/launch.json` (`mobile`, `web`, `admin`, `widget`, or the `*-mock` variants) and walk the flow in the browser. Check loading, empty, error and success. Resize to phone width. Switch the language to `fa` and check RTL and text length. Look for regressions on nearby screens. Reading the source is not verification.
4. **Regression check** — Verify nothing else broke, in every target the change touches.
5. **Fix failures** — If anything fails, fix it and re-verify. Report what was wrong and how it was fixed.

**Exit criteria:** lint, build and tests pass; the new test proves the change; the flow was walked in the running app in every affected target.

Output:
```
### VERIFICATION RESULTS
- **pnpm lint / build / test:** <pass/fail>
- **pytest:** <pass/fail, or "backend untouched">
- **e2e:** <pass/fail, or "no user flow changed">
- **Manual check:** <targets walked, states checked, fa/RTL checked>
- **Regressions:** <none found / list>
```

---

## Final Output

```
## IMPLEMENTATION COMPLETE ✓
**Task:** $ARGUMENTS
**Phase 1 (Research):** ✓ <brief>
**Phase 2 (Plan):** ✓ <brief>
**Phase 3 (Implement):** ✓ <file count> files changed
**Phase 4 (Verify):** ✓ <test results>
**Docs updated:** <docs/API.md, mock handlers, ADR, CHANGELOG, or "none needed">
**Left out:** <anything not done, and why>
**Ready for:** code-review, commit, PR
```
