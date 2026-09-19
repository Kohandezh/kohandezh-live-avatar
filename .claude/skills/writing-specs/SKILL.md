---
name: writing-specs
description: Use to author a feature spec at docs/features/<slug>/SPEC.md, from docs/templates/SPEC.md. A spec says exactly what will ship, before any plan or code. Drives the whole loop: check the gate (is the approach already settled by research, by an ADR, or by an existing pattern, and stop if it is not), fill all 13 template sections, give requirements stable ids on a large spec, fill the UX states that AGENTS.md makes mandatory, self-review against references/spec-self-review.md, register the row in docs/features/INDEX.md, and take the spec Draft to Approved to Implemented. Reach for this when the user says "write a spec", "turn the research into a spec", "spec out this feature", or "what should the spec cover". Covers only the spec. The research before it belongs to writing-spikes, the plan and the code after it belong to implement.
---

# Writing Specs

A spec answers **exactly what will ship**: behaviour, inputs and outputs, state, edge cases, errors, permissions, data changes, rollout and acceptance. It is the contract between a settled approach and the code.

This skill is the **method**. The repo owns the shape and the rules. Read these as the source of truth rather than duplicating them:

- `docs/templates/SPEC.md`: the 13 sections to fill.
- `AGENTS.md`: Engineering Standards (the bar a spec may not spec its way around) and UI/UX Engineering Standards 1-15 (the mandatory gate for anything a person sees).
- `CLAUDE.md` and `ARCHITECTURE.md`: the layers, the four targets, state ownership.
- `docs/SECURITY.md`, `docs/API.md`, `docs/DATA_MODEL.md`, `docs/TEST_PLAN.md`.
- `docs/features/INDEX.md`: the feature index, and the table of what document goes where.

**Scope:** this skill produces one `SPEC.md` and takes it to Approved. It does not do the research before it (`writing-spikes`) and it does not plan or write the code after it (`implement`).

## When a spec is warranted

Most changes do not need one. Write a spec when at least one is true:

- the feature spans more than one of the four targets, or crosses the frontend/backend line
- it adds or changes an endpoint, a table, or the auth model
- it has enough states that getting them wrong is likely (a flow, not a screen)
- more than one person will build it, or it will be built in slices across several PRs
- the user asked for one

A one-screen change with an obvious shape does not need a spec. Do not create a document to satisfy ceremony (`AGENTS.md`, Change Strategy).

## Where things live

- **`docs/features/<slug>/SPEC.md`** is the feature spec. That is what this skill writes.
- **`docs/features/<slug>/RESEARCH.md`** is the spike that settled the approach, if there was one.
- **`docs/DECISIONS/NNNN-<slug>.md`** is an ADR: a decision that outlives this one feature. A spec does not replace an ADR, and an ADR does not replace a spec.

## The process

### 1. Check the gate, or say in the spec why it is skipped

A spec is written **from** a settled approach, not while choosing one. Before opening the template, answer: is the technical approach decided on evidence?

| What you have | What to do |
| --- | --- |
| `docs/features/<slug>/RESEARCH.md`, complete, outcome `→ SPEC` | Read it in full (step 2) and link it in section 13. |
| An ADR that settles the approach | Cite it in section 13. |
| Neither, but the change reuses a pattern already in the repo | Fine. Write one line in section 13 naming the pattern and the file it lives in. That line is the evidence. |
| Neither, and there is real uncertainty | **Stop.** Route to `writing-spikes`. |

Real uncertainty means an unfamiliar dependency, a performance or scale question, a risky provider integration, a compatibility risk across the four targets, or behaviour in existing infrastructure nobody has checked. A spec that quietly picks an approach nobody investigated is where the expensive mistakes come from.

If a design question surfaces while you are writing the spec, that is the last row arriving late. Stop and go research it.

The common case in this repo is a spec written from an existing pattern. That is allowed. It is not allowed silently.

### 2. Read the inputs in full

The approach is already decided. Do not reopen it. Read for:

- The **chosen approach** and the constraints it satisfies.
- **Trade-offs accepted.** These become the rationale in the spec.
- **Open questions** the research deferred. Answer each one now, or park it explicitly.
- **Assumptions tagged unverified.** Verify them against the code before promoting one into a requirement.
- The **outcome**. If it was `→ ADR`, that ADR should already exist before the spec leans on it.

### 3. Ask clarifying questions, one at a time

Research answers **how**. A spec still needs **what**: behaviour, states, limits, acceptance. Find the gaps, then ask one question at a time, preferring multiple choice when the answer space is bounded:

- **Which targets?** A shared screen reaches both `mobile` and `web`. Does the `admin` dashboard need it? Can the `widget` reach it at all, given it has no router and no Redux?
- **What does the user see when it fails, when it is empty, and when it is slow?**
- **Who is allowed?** A signed-in user, an admin, or an anonymous widget visitor. There is no fourth answer.
- **What is explicitly out of scope**, so it does not creep in at review?

Do not ask about the approach. That is settled. Do not ask several questions at once.

The product owner writes in Finglish, so expect the answers in Finglish. The spec itself is written in English.

### 4. Create the file

```bash
mkdir -p docs/features/<slug>
cp docs/templates/SPEC.md docs/features/<slug>/SPEC.md
```

The slug is lowercase and hyphenated, describing the feature, not a date and not an issue id (`session-recording`, `admin-user-search`, `widget-theming`). It matches the folder and the `RESEARCH.md` beside it if there is one.

### 5. Fill every section

Fill all 13 sections. Do not leave placeholders and do not drop a section because it felt empty. Notes on the ones that go wrong most often:

**Header.** The field table at the top. `Status` runs `Draft → Approved → Implemented`, plus `Superseded` for a spec a later one replaced. `Targets` names which of `mobile`, `web`, `admin`, `widget` this touches. `Sources` is where the step 1 gate evidence goes. These fields line up one to one with the row you add to `docs/features/INDEX.md` in step 7.

**2. Scope.** Out of scope is phrased as exclusions ("this phase does not support X"). They are what stops a reviewer asking "why didn't you include X?".

**3. Actors and permissions.** Name the real mechanism: `get_current_user`, `require_admin` on the router, or the embed key plus an allowed `Origin`. State plainly that the frontend guards are UX only. See the `authorization` skill.

**5. Behaviour.** Be testable. "The system should handle errors gracefully" is not a requirement. "A request with no session returns 401 and the screen sends the user to `/login`, keeping the attempted path in router state" is.

Say which system owns each piece of state. Server data goes through TanStack Query, client-owned global state through Redux, everything else stays local. Never two at once.

**6. API contract.** Follow `docs/API.md` and `apps/api/README.md`. An endpoint returning an unbounded collection defines its paging. Long work answers `202` with a job id. Name the three places that change with the code: `docs/API.md`, the entity's Zod schema, and `src/data/mock/handlers.ts`.

**7. Data model.** Migrations are **append-only**, applied in order on startup from `apps/api/services/orchestrator/migrations/`. Say whether the change is additive. There is no downgrade path.

**8. Errors and edge cases.** Name the user-facing wording, and remember it needs a key in **both** `en` and `fa`. An error tells the user what happened, what they can do, whether retry is safe, and whether their input is kept.

**9. Security and privacy.** Never empty. An empty security section is a red flag at review. Answer: who is authorized and where is that enforced; what is logged and what must never be logged (tokens, codes, unmasked phones); where any token lives; what a public response exposes.

**10. UX states.** The template lists fourteen. `AGENTS.md` UI/UX standards 3 and 15 make this a mandatory gate for any user-facing change, so fill every line. "N/A, backend only" is a valid answer for a backend spec. A blank line is not. Name the shared primitive that covers each state (`LoadingState`, `EmptyState`, `ErrorState`, `OfflineBanner`, `RequireAuth`).

**11. Compatibility and rollout.** Which of the four targets are affected, who depends on the current behaviour, and whether the backend has to ship before the client.

**12. Acceptance criteria.** Binary and observable. "The user list loads the first page in under one second with 10,000 rows" is observable. "The list is reasonably fast" is not. Follow it with a short **Tests** section naming the files at the right layer.

**13. Related artifacts.** Research, ADR, Linear issue, PR. Put the step 1 gate evidence here.

#### Requirement ids

On a large spec, give requirements stable ids so a reviewer, a test and a PR can all point at the same line.

| Prefix | For |
| --- | --- |
| `REQ-NNN` | a functional requirement |
| `SEC-NNN` | a security requirement |
| `US-NNN` | a user story |
| `SC-NNN` | a success criterion, binary pass or fail |

Pad all four to three digits so they sort. Group `REQ` ids by area, each group a separately mergeable piece of work: that grouping is what turns one spec into a stack of scoped PRs.

Use "must" for non-negotiable and "should" only when something is genuinely optional. Every requirement is a testable statement.

For a small spec the ids are overhead. Skip them and keep the prose testable. Never half-apply them: some requirements numbered and some not is worse than none.

#### Diagrams

Invoke the `diagrams` skill where a section has shape rather than prose. It decides whether a diagram earns its place, picks the type, draws it from the code rather than from memory, and checks it reads before commit.

- **4. User and system flow**: a `flowchart` of the change surface, or a `sequenceDiagram` when the flow crosses three or more participants (page, query hook, API client, backend, provider).
- **5. Behaviour**: a `stateDiagram-v2` when an entity gains a lifecycle (a session, an upload, a recording).
- **7. Data model**: an `erDiagram` when the spec adds or reshapes tables.

Proposed components must look different from shipped ones (dashed), so a reviewer never has to guess which half already exists.

### 6. Self-review before anyone else reads it

Read `references/spec-self-review.md` for the full checklist. The four gates:

1. **Placeholder scan.** No "TBD", no empty template section, no vague requirement.
2. **Internal consistency.** The flow matches the behaviour, the acceptance criteria trace back to requirements, the out-of-scope list does not contradict the in-scope list.
3. **Scope check.** The spec is deliverable as a realistic set of scoped PRs, each one root cause (see `scoped-pr`). If it clearly spans two independent areas with separate lifecycles, split it.
4. **Ambiguity check.** Every requirement can be read only one way by an implementer who has not seen the research.

Fix every finding inline. Do not hand over a spec with known gaps.

### 7. Register it in INDEX.md

Add or update the feature's row in `docs/features/INDEX.md`, in the **same commit** as the spec. Columns are `Slug | Spec status | Research | Domain | Targets | Created | Updated`.

Be honest. A row saying `Implemented` for something that is not implemented is worse than no row (`AGENTS.md`, Documentation Honesty).

### 8. Draft to Approved to Implemented

**Approved** means the reviewer agrees this is what should ship. Review happens in the pull request. Apply the change requests, re-run the self-review, then set Status to `Approved` and update the INDEX row in the same commit.

**No implementation begins until Approved.** That is the point of the gate. After that, hand off to `implement`.

**Implemented** is set when the code has shipped, not when the PR opened.

If reality diverged from the spec during implementation, update the spec. A spec describing a feature that was built differently is read as current by the next agent, and it will be wrong.

## The quality bar

A spec is doing its job when the approach behind it is settled and its source is named in section 13, every requirement is testable and on a large spec carries a stable id, the security section is not empty, the UX states are filled for anything a person sees, the targets are named, the data-model section says whether the migration is additive, the acceptance criteria are observable, the work is a reviewable set of PRs, and the INDEX row tells the truth.

The first thing a reviewer should be able to do is read Purpose and Scope and immediately know what is being built and what is deliberately not.

## References

- `references/spec-self-review.md`: the full self-review checklist. Read at step 6.
- The `diagrams` skill: the flow, state and schema diagrams. Invoked at step 5.
- `docs/templates/SPEC.md`: the 13 sections.
- `docs/features/INDEX.md`: the index, and the table of what document goes where.
- `AGENTS.md`: the Engineering and UI/UX standards a spec is measured against.
- The `scoped-pr` skill: turning an approved spec into a stack of one-root-cause PRs.
