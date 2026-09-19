---
name: writing-spikes
description: Use when starting a non-trivial feature or facing a "which X should we use / how should we build Y" question in this repo, where real uncertainty has to be settled with evidence before a spec or any code. Drives the research step: frame one question, gather evidence-based options (codebase verification first, then outside research), write it to docs/features/<slug>/RESEARCH.md from docs/templates/SPIKE.md, and route the outcome to a SPEC, an ADR in docs/DECISIONS/, a PLAN, or no action. Reach for it whenever you would otherwise jump straight into designing or building, or when the user says "write a spike", "research an approach", "compare options", "should we use A or B", or "do a technical investigation". Covers only the research step, not the spec that follows.
---

# Writing Spikes

A spike answers **what we do not know yet**, with evidence, before anyone designs or builds. In this repo it lands in `docs/features/<slug>/RESEARCH.md`.

This skill is the **method** for producing a spike a reviewer can trust, and for **routing its outcome**. The repo owns the shape and the rules. Read these as the source of truth rather than duplicating them:

- `docs/templates/SPIKE.md`: the section structure to fill.
- `ARCHITECTURE.md` and `CLAUDE.md`: the layers, the four targets, the boundaries a recommendation has to respect.
- `AGENTS.md`: Engineering Standards 3 (over- and under-engineering) and 4 (STOP conditions), and the UI/UX standards when the answer touches a screen.
- `docs/DECISIONS/`: thirteen ADRs. Read the relevant ones before recommending anything that contradicts one.
- `docs/SECURITY.md`: the rules no recommendation gets to trade away.

**Scope:** this skill ends at a complete `RESEARCH.md` with a recommendation and one outcome. It does not write the spec and it does not write the ADR. It decides which comes next and hands off.

## First: does this need a spike at all?

Process scales with risk. Do not create a document to satisfy ceremony. A spike is for **meaningful uncertainty**:

- an unfamiliar dependency or an external API
- performance, bundle size, or scale uncertainty
- a compatibility risk across the four targets, or across web and native
- unclear behaviour in existing infrastructure (the provider SDK, LiveKit, Capacitor, the service worker)
- a risky provider integration, especially one that costs money per call
- feasibility that cannot be decided by reading the repository

If reading the code answers the question, read the code and skip the spike. Say so in one line. A small fix, a copy change, or a feature that reuses an existing pattern goes straight to implementation.

## The process

### 1. Frame one question

One decision per spike. If you are tempted to answer two, split them. Write it as a specific question ("Which X fits this app for Y?", "How should we build Z?") and capture the sub-questions that surface while investigating.

List the **constraints the answer must respect**. In this repo those are usually:

- **Four targets from one codebase.** `mobile` (Capacitor), `web` (PWA), `admin`, `widget` (Shadow DOM, no router, no Redux). An answer that only works in one target is a partial answer, and it has to say which targets it covers.
- **Layers.** `app → pages → features/entities → shared`. No reverse dependency, and `shared/` stays domain-agnostic.
- **Stack.** React 19, TypeScript strict, Vite, Tailwind v4, HeroUI v3, TanStack Query, Redux Toolkit, Zod. Backend is FastAPI on PostgreSQL 16 and Redis. Do not add a dependency the existing stack already covers.
- **Bilingual and RTL.** English and Persian. Persian is longer and flips direction.
- **Security.** The backend owns authorization. Tokens never reach `localStorage` on web or a log. `docs/SECURITY.md` is not negotiable.
- **Provider cost.** LiveAvatar and ElevenLabs calls spend real credit. An approach that multiplies calls has a price, and the spike has to name it.
- **On-premise installs.** Some installs serve web and admin from one origin and need no CORS. An approach that assumes a cloud topology has to say so.

These are not throat-clearing. They become the axes you score options against and the reason a recommendation wins.

Set a **timebox**. A spike without one sprawls.

### 2. Ground in the real codebase first

Before looking outward, map what already exists and **verify that the integration points the feature would depend on actually exist**. Read the code, do not assume. A single unchecked "the data is not available here" can invert the whole design.

Note current behaviour, the concrete hook points, the schema, and the conventions, and cite file paths with line numbers. Start from:

- `src/shared/`, `src/features/`, `src/entities/`: is there already a correct pattern for it?
- `src/shared/api/` and `docs/API.md`: what does the contract already allow?
- `apps/api/services/orchestrator/src/` and `migrations/`: what does the schema really look like?
- `docs/DECISIONS/`: has this already been decided? Re-opening a settled decision without saying so is the fastest way to get a spike rejected.
- `docs/features/INDEX.md` and the sibling folders: has someone already researched this?

Use the `software-architecture` and `authorization` skills when the area is unfamiliar.

### 3. Research with evidence

Fan out independent investigations and **keep the conclusions, not the raw dumps**. Typical lanes, pick what fits:

- **Options landscape**: what is actually available, scored for **this** stack, not generically. A frontend package has to work under Vite with Tailwind v4 and ship to four targets, including inside a Shadow DOM.
- **Prior art**: how comparable products solve it. Reuse a proven pattern rather than inventing one.
- **Production readiness**: real limits, failure modes, security exposure, bundle size, provider cost. Not just the happy path.
- **Codebase verification**: confirm the specific hooks, limits and data the design relies on.

Use the **Context7 MCP** for library, framework and SDK documentation rather than memory. Library APIs change and a spike built on a remembered API is a spike built on nothing. For HeroUI, use the `heroui-react` MCP server or skill.

Hold a high bar: **evidence over assertion**. A claim without a concrete source (docs, a benchmark you ran, a file path, a prototype) is not a finding. Check load-bearing claims adversarially before you build on them, and cite sources inline (URLs and `file.ts:line`). That is what lets a reviewer trust the recommendation without redoing the work.

Where a measurement decides the question, **run it**. A bundle-size question is answered by `pnpm build` and reading the output, not by an argument. A rendering question is answered in the browser from `.claude/launch.json`. A measured number beats an opinion.

Provider calls cost credit. The opt-in integration tests under `apps/api/services/orchestrator/tests/integration/provider/` are the only sanctioned way to touch a real provider, and they need `REAL_PROVIDER_TESTS` and `CONFIRM_CREDIT_USAGE`. Ask before spending.

### 4. Write it

```bash
mkdir -p docs/features/<slug>
cp docs/templates/SPIKE.md docs/features/<slug>/RESEARCH.md
```

The slug is lowercase and hyphenated, describing the feature, not a date and not a ticket id (`session-recording`, `offline-queue`, `widget-theming`). It matches the folder, and later the `SPEC.md` next to it.

Fill every section. Four carry the weight:

- **The question** and **why it is open**: the one decision, and what is blocked until it is answered.
- **What the codebase already does**: evidence with file paths, before any outside research.
- **Options**: each with how it works, the evidence, whether it fits each constraint from section 3, and what it costs. **Real alternatives**, not a foregone conclusion dressed up.
- **Recommendation**: the pick, **why it wins given the stated constraints**, and an explicit "what we trade off". Every choice loses something. Name each loss and its mitigation. Also state how hard the decision is to undo, because that feeds the ADR call in step 5.

**Assumptions not verified** is where an unverified belief belongs. Tag each assumption verified-against-code or unverified, and never promote an unverified one into a requirement.

Always answer security, even when the answer is "no new trust boundary". It feeds the escalation call in step 5.

Any prototype code you wrote is throwaway. Say so explicitly, and do not let it become production work by accident.

**Language.** Write the document in English. Keep code, commands, file paths and error text exactly as they are.

#### Diagrams

Where a section has shape rather than prose, invoke the `diagrams` skill instead of describing the shape in a paragraph.

One is close to required: the **Recommendation** section wants a `flowchart TB` of the pick, the gates it depends on, and where each failed gate lands. A research doc whose recommendation can only be recovered by reading the whole file has not finished its job. Drop it only when there is no contingency, no fallback and no ordering constraint, and say so in a line.

The rest are defaults, not quotas. **What the codebase already does** wants a `flowchart` of the current system with proposed nodes dashed. **Options** wants a `quadrantChart` once you are ranking more than about five candidates on two axes. Skip either without apology when there is nothing shaped to show. A decorative diagram is worse than none.

### 5. Choose the outcome

A spike ends with a recommendation and exactly **one** outcome:

| Outcome    | When | Where it goes next |
| ---------- | ---- | ------------------ |
| `→ SPEC`   | behaviour needs to be made precise across files, layers, targets or states | `docs/features/<slug>/SPEC.md`, via `writing-specs` |
| `→ ADR`    | the recommendation is a durable architectural decision | a new `docs/DECISIONS/NNNN-<slug>.md`, then usually a spec |
| `→ PLAN`   | the approach is clear and reuses an existing pattern, so a spec would add nothing | straight to `implement` |
| `→ no action` | the investigation says do not build it, or the question dissolved | record why, and stop |

Record the outcome in the template's **Outcome** section. State clearly what, if anything, from the spike becomes production work.

When the outcome is, or might be, `→ ADR`, read `references/adr-escalation.md` for the bar, the concrete triggers, and what the ADR adds. Record the escalation and the questions the ADR must settle. Do **not** write the ADR here.

### 6. Close it out

Set the template's **Status** to `Resolved`. Then:

- Add or update the feature's row in `docs/features/INDEX.md`, in the same commit. Research done and nothing built yet is `Spec status: Draft` (or blank) with `Research: Resolved`.
- List the concrete **follow-up** actions and the **open questions** the downstream author still has to answer.
- Hand off. `→ SPEC` continues with `writing-specs`. `→ PLAN` goes to `implement`. `→ ADR` gets the ADR written first.

**One thing to know about RESEARCH.md.** It plays two roles. Before the work it is the research gate. After the work it often becomes the feature's durable notes. If your spike becomes that record, keep it accurate as the code changes, or delete the parts that stopped being true. A stale research doc is read as current by the next agent (`AGENTS.md`, Documentation Honesty).

## The quality bar

A spike is doing its job when it answers **one** clear question, its findings are **evidence-backed and verified against the real code** rather than remembered, it presents **genuine alternatives**, it says which of the four targets each option covers, the recommendation states **what it trades off**, a reader can name the pick and the risk it carries from the recommendation alone, prototype code is clearly separated from production work, and it ends with the **right outcome**, escalated to an ADR when the stakes warrant it.

## References

- `references/adr-escalation.md`: when a spike's recommendation needs an ADR. Read at the outcome step.
- The `diagrams` skill: the recommendation diagram and any context or options visual.
- `docs/templates/SPIKE.md`: the section structure.
- `docs/DECISIONS/`: the existing ADRs and the shape a new one takes.
- `docs/features/INDEX.md`: the index, and the table of what document goes where.
