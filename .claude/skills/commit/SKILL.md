---
name: commit
description: Use when creating git commits in this repo. Runs the local checks (pnpm typecheck/lint/test for the frontend, pytest for apps/api), writes a scoped conventional commit message with the required trailer, and suggests splitting a diff that spans more than one root cause.
---

# Commit

## Overview

Create clean commits with conventional commit messages. Run the local checks, read the diff, split it when it holds more than one change, and add the trailer this repo requires.

Commit only when the user asks for it. If you are on `main` (the default branch), create a branch first. The `scoped-pr` skill owns branch naming and PR boundaries.

## What this does

1. **Pre-commit checks.** Run the checks that cover what you changed. They are the same commands CI runs (`.github/workflows/ci.yml`), so a local pass is a real signal here, unlike a repo with no local gate.

   Frontend (`apps/frontend`) changed:

   ```bash
   pnpm typecheck    # tsc -b across the workspace
   pnpm lint         # eslint
   pnpm test         # vitest run
   pnpm build        # builds all four targets
   ```

   `pnpm build` also type-checks, so on a small diff `pnpm lint && pnpm build && pnpm test` is enough.

   Backend (`apps/api`) changed:

   ```bash
   docker compose run --rm orchestrator pytest -q
   ```

   That is what CI does. A bare `pytest -q` from the repository root also works when your local Python environment has `apps/api/services/orchestrator/requirements.txt` installed, but it needs PostgreSQL and Redis from `docker compose up -d`.

   Secrets, whenever anything under `apps/frontend` or `.env.example` changed:

   ```bash
   ./scripts/check-frontend-secrets
   ```

   This job is blocking in CI. Only `VITE_*` values reach the browser and all of them are public, so a server secret named anywhere under `apps/frontend` is a leak.

   A user flow changed: run `pnpm test:e2e` as well (browsers come from `pnpm --filter @app/frontend exec playwright install` once).

   After pushing, CI is still the final word:

   ```bash
   gh run list --branch <branch> --limit 1
   gh run watch
   ```

2. **Stage the files.** Check `git status`. If nothing is staged, stage the modified and new files that belong to this change. Never `git add .` blindly: `node_modules/`, `dist/`, `.env`, `playwright-report/`, `media/` output and local scratch files must stay out.

3. **Read the diff.** Run `git diff --staged`. Decide whether it is one change or several.

4. **Write the message.** Conventional format with a scope, plus the required trailer.

## Conventional commit format

```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

**Types:**

- `feat`: a new feature
- `fix`: a bug fix
- `docs`: documentation changes
- `style`: formatting or visual-only change, no behavior change
- `refactor`: code change that neither fixes a bug nor adds a feature
- `perf`: performance improvement
- `test`: adding or fixing tests
- `build`: build system or dependency change
- `ci`: CI configuration
- `chore`: tooling and housekeeping

**Scope.** This repo uses one. Read the recent history (`git log --oneline -20`) and match it. Useful scopes are a target (`mobile`, `web`, `admin`, `widget`), a feature folder (`auth`, `assistant`, `settings`, `profile`), a backend service (`api`, `orchestrator`, `liveavatar`, `elevenlabs`), or an area (`ui`, `build`, `ci`, `test`, `docs`). Drop the scope only when the change is genuinely repository-wide.

**Guidelines:**

- Present tense, imperative mood ("add feature", not "added feature").
- First line under 72 characters.
- Explain the why in the body when the change is not obvious from the subject. The what is already in the diff.
- No em dashes. Use a period, a comma, or parentheses.
- End the message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. This repo requires that trailer on every commit you create.
- Reference the Linear issue in the footer when one exists (`Refs ENG-123`). Work is tracked in Linear; it lands through GitHub PRs.
- For a PR in a stack, keep the stack position (`[2/3]`) out of the commit subject. It belongs in the **PR title** (see the `scoped-pr` skill). Commits get squashed on merge, so a per-commit marker is noise.

## When the change touches certain areas

- **An endpoint.** The commit includes `docs/API.md` and `apps/frontend/src/data/mock/handlers.ts` together with the code, plus the entity's Zod schema. A contract change touches both apps in one commit (`docs/CONTRIBUTING.md`).
- **A migration.** The numbered file goes in `apps/api/services/orchestrator/migrations/`. Migrations are applied on startup, in order. Never edit a migration that has already run anywhere; add the next number instead.
- **A new frontend dependency.** Add it to the `package.json` that imports it, not the root. pnpm links only declared dependencies, and `shamefully-hoist` stays off (`AGENTS.md`). Commit the updated `pnpm-lock.yaml` in the same commit.
- **A new backend dependency.** Record it in `apps/api/services/orchestrator/requirements.txt` in the same commit.
- **User-facing text.** Every new key exists in both `apps/frontend/src/i18n/locales/en` and `.../fa`, in the same commit.
- **An architectural decision.** Add or update the ADR under `docs/DECISIONS/` in the same commit.
- **Docs the change invalidates.** Update them in the same commit. `CLAUDE.md` and `AGENTS.md` list which file to touch for which kind of change. A user-visible change also updates `CHANGELOG.md`.

## Guidelines for splitting commits

Split on:

1. **Different concerns.** Unrelated parts of the codebase.
2. **Different types.** A feature mixed with a refactor mixed with a fix.
3. **Different apps.** A frontend change and an unrelated backend change. A contract change that needs both is one commit, not two.
4. **File patterns.** Source against docs against tests, when they are genuinely separate work.
5. **Size.** A very large change is clearer in steps.

If the diff spans more than one **root cause**, this is a PR boundary problem, not just a commit problem. Stop and use the `scoped-pr` skill to split the work into separate branches and PRs before committing.

## Examples

Good subjects:

- `feat(assistant): add a text composer to the conversation controls`
- `fix(auth): keep the session cookie after a language switch`
- `docs(api): record the OTP resend window in API.md`
- `refactor(settings): move theme resolution out of ThemeSync`
- `test(e2e): cover the forbidden path on the admin router`
- `perf(widget): stop re-injecting the stylesheet on every mount`

Full message:

```
fix(auth): reject a one-time code after the first successful use

A code stayed valid for its whole TTL, so a leaked SMS could be replayed
until it expired. The code is now consumed on the first verify and the
second attempt fails like an unknown code.

Refs ENG-142

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Split example:

- First: `feat(api): add the GET /api/admin/sessions endpoint`
- Second: `feat(admin): list sessions on the admin dashboard`
- Third: `test(admin): cover the empty, error and forbidden states`
