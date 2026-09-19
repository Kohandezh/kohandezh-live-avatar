---
name: scoped-pr
description: Use when taking on bug fixes, addressing reported issues, or any change that could span multiple root causes, and again before creating a branch, commit, or pull request. Keeps each PR scoped to one root cause (not one file, not one ticket), and drives the branch, commit, and `gh pr create --draft` flow this repo uses.
---

# Scoped PR

## Overview

One reviewable idea per PR. Scope every PR to a single **root cause**, not one file and not one ticket.

Apply this at two moments:

1. **Early**, when you take on work that fixes a bug or addresses an issue, *before* writing code. Decide the PR boundaries up front.
2. **Backstop**, before you branch, commit, or open a PR. Re-check that the change still maps to one root cause.

The reasoning behind it is in `AGENTS.md`: Engineering Standards 3 (avoid over- and under-engineering), 4 (STOP conditions) and 9 (Definition of Done), plus the Change Strategy section.

## Step 1: decide the boundary first

Before touching code, list the distinct root causes in the requested work. **One root cause equals one PR.** If the task holds N independent causes, plan N branches and N PRs.

Decide with these tests:

- **Split when** the changes have different *causes*, fix different *symptoms*, or could be reverted independently. Ask: "Could I revert fix A without affecting fix B?" If yes, separate PRs.
- **Keep together when** several files share *one* cause (one bug touching the page, the feature hook, and the entity schema), or when splitting would leave a state that does not run.
- **Keep a contract change together.** A new or changed endpoint spans `apps/api`, `docs/API.md`, `apps/frontend/src/data/mock/handlers.ts` and the entity schema. That is one cause, so it is one PR, across both apps (`docs/CONTRIBUTING.md`).
- **Do not over-split.** Mechanical churn from a single action (one rename across the repo, one docs sweep) stays one PR. Splitting an atomic change into five PRs is as wrong as bundling five causes into one.
- **The drive-by test.** "Am I changing this because the task needs it, or because I am already in the file?" The second is always a separate PR. No drive-by renames, no "while I was here" refactors.

If the work is one cause, continue. If it is several, run the steps below once per cause, finishing one PR before starting the next.

## Step 2: start clean, off the latest main

The default branch is `main`. Branch from the freshly fetched remote tip so unmerged work from a previous fix never leaks into this PR:

```bash
git status --short                     # must be clean; stash or commit first
git fetch origin
git switch -c fix/<short-name> origin/main
```

Branch names follow the type prefix of the commit: `fix/`, `feat/`, `chore/`, `docs/`, `refactor/`, `ci/`. This matches the history (`feat/audio-control-layer`, `chore/turborepo`, `ci/github-actions`).

### Optional: isolate in a worktree

Switching branches in place is the default. Use a worktree **only when you want isolation** (to keep the current checkout untouched, or to work on several PRs at once).

- Prefer the harness's `EnterWorktree` tool over raw git when it is available.
- Check you are not already isolated first: if `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`, you are already in a worktree. Do not nest.
- Manual path:

  ```bash
  git fetch origin
  git worktree add ../kohandezh-<branch> -b fix/<short-name> origin/main
  ```

  A worktree does not need a clean tree, because it leaves the current checkout alone.
- A fresh worktree has no `node_modules`. Run `pnpm install` there before any `pnpm` command.

### Big features: stack, do not bundle

A large feature is still one root cause per PR. Slice it into a stack of dependent PRs with **GitHub's native stacked PRs via `gh stack`** (`gh extension install github/gh-stack`), not hand-set base branches. GitHub tracks the chain, shows each PR's position, and merges the stack atomically.

```bash
gh stack init feat/x-1-api          # bottom slice, off main
# …commit…
gh stack add feat/x-2-frontend      # next slice, branched off the one below
# …commit…
gh stack submit                     # push all branches, open the linked PRs
```

`gh stack submit` opens an editor per new PR (Ctrl+S submits all). `--auto` uses generated titles, `--open` creates them ready for review instead of draft. Re-run `submit` whenever you add commits or slices. Move around with `gh stack view` / `down` / `up` / `top`. To fix a lower slice: `gh stack down`, commit, `gh stack rebase --upstack`, `gh stack submit`.

Each PR's diff then shows only its own slice, and `gh stack merge` lands them bottom-up. Full merge and rebase procedure: the [merge-stacks](../merge-stacks/SKILL.md) skill.

A natural slice order in this repo is: backend endpoint and migration, then contract (`docs/API.md` and the mock handler), then the frontend feature, then the screens per target. Keep every slice runnable on its own.

**Titles.** GitHub's stack UI already shows each PR's position, so an `[n/N]` marker is optional. Add one only if the user asks. Do state the dependency in the body (`Stacked on #10, merge after it`), and keep any marker out of commit messages, because commits get squashed on merge.

## Step 3: fix it, test first

Write the failing test before the fix (red, then green). The test must fail when the fix is removed. Put it at the right layer (`docs/DEVELOPMENT.md`, `AGENTS.md` Testing Standard):

- pure logic, Zod schemas, reducers: `apps/frontend/tests/unit/`
- pages, guards and hooks with providers, against the mock API: `apps/frontend/tests/integration/`
- a user flow inside a target: `apps/frontend/tests/e2e/` (Playwright, TypeScript)
- backend logic and endpoints: `apps/api/services/<service>/tests/` (pytest)

A security-sensitive change tests the denied path too, not only the allowed one. A user-facing change covers the non-happy states: error, empty, 401, 403, offline.

Keep the diff confined to the one root cause. Put the code in the layer the dependency direction allows (`app → pages → features/entities → shared`). If it does not fit any existing layer, that is a STOP condition, not a reason to invent one.

## Step 4: check and commit

Run the checks that cover what you changed:

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

Then use the `commit` skill. It writes the scoped conventional message and the required `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer. If it flags that the diff spans more than one root cause, stop and return to Step 1.

## Step 5: open the PR as a draft

Use `gh` directly:

```bash
git push -u origin HEAD
gh pr create --draft --base main \
  -t "fix(assistant): keep the session alive across a language switch" \
  -F /tmp/pr-body.md
```

Useful flags: `-t/--title`, `-b/--body`, `-F/--body-file <path>` (`-` reads stdin), `-d/--draft`, `-f/--fill` (title and body from the commits), `-r/--reviewer`, `-l/--label`.

Open as a **draft** and mark it ready once CI is green and the review is done:

```bash
gh pr checks --watch
gh pr ready
```

CI runs three jobs (`.github/workflows/ci.yml`): `frontend` (typecheck, lint, test, build, secret check), `e2e` (Playwright, needs `frontend`), and `backend` (pytest under Compose). All three must pass.

### PR body

State the root cause, not just the change. A useful body answers: what was broken, why, what the fix does, and how it was verified. For a user-facing change, say which targets you walked and that you checked RTL.

```
Root cause: ThemeSync wrote data-theme but not the `dark` class, so every
HeroUI `dark:` utility kept the light value after a switch.

Fix: write both on <html> and update <meta name="theme-color"> with them.

Verified: new test apps/frontend/tests/unit/features/settings/themeSync.test.tsx
(fails on main), plus pnpm lint/build/test. Walked mobile and web at phone
width in both en and fa.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

End every PR body you write with that trailer line.

**Visuals in the body.** When the description has to explain a *shape* (a call path that moved, a file that split, a state machine that gained a branch), a sketch is shorter than the paragraph it replaces. The `show-me` skill owns the form, and a `diff` block showing a call tree before and after is the usual fit. GitHub renders `diff`, `text`, and `mermaid` blocks in a PR body. At most one per PR, and it replaces prose rather than adding to it.

## Step 6: next root cause

Return to Step 2 from a fresh `main`-based branch. Never continue an independent fix on the previous fix's branch.

## Sizing budget

Soft, not a gate. If a PR passes roughly 400 lines or more than one root cause, justify it in the description or split it. Treat "can this be split?" as a normal question, not a failure.
