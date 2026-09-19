# When a spike needs an ADR

Read this at the **outcome** step of a spike. The spike is the research. The ADR is the durable record of the decision it produced. Most spikes route straight to a spec. Escalate to an ADR only when the recommendation carries lasting architectural weight.

## Where an ADR lives here

`docs/DECISIONS/`, one file per decision, numbered and slugged: `0013-physical-anchoring-for-conversation-controls.md`. Thirteen exist today. Check the highest number before you pick one.

Match the shape of the surrounding files: a `# NNNN. Title`, a `## Context`, a `## Decision`, and the consequences. They are short. An entry nobody can read is not an entry.

Write it in English, like the rest of `docs/`.

## The escalation test

Route on the recommendation:

| Recommendation | Next |
| --- | --- |
| Clear approach, reuses an existing pattern, no lasting risk | → **SPEC** or **PLAN** |
| New dependency or trust boundary, cross-cutting, or hard to reverse | → **ADR**, then a spec |

Concretely, write an ADR when the recommendation introduces any of these:

- **A change to a layer or folder boundary.** Where code lives is the thing every future change copies. ADR 0001 (shared cross-platform) and ADR 0008 (monorepo layout) are this shape.
- **A change to the build targets.** Adding, removing or re-scoping one of `mobile`, `web`, `admin`, `widget`. ADR 0004 and ADR 0010 are this.
- **A new external dependency or service that becomes load-bearing.** A component library, a state library, a provider SDK, a package manager. ADR 0011 (HeroUI), ADR 0009 (pnpm) and ADR 0012 (Turborepo) are all this.
- **A change to the auth model or a new trust boundary.** A new way something reaches the app from outside, or a new place user data lives. ADR 0002 is the existing record.
- **A change to state ownership.** Which system owns which state. ADR 0003 is the existing record, and quietly contradicting it is how server state ends up in Redux.
- **A change to the API contract's shape**, not one endpoint but the pattern. ADR 0007 is this.
- **A deliberate exception to a house rule.** ADR 0013 is the clearest example: the conversation controls do not mirror in RTL, against the logical-CSS rule. Without the ADR, a reviewer sees `left` in a bilingual app, assumes somebody forgot, and "fixes" it. **The ADR exists to stop that change.**
- **A one-way door.** Expensive to migrate off later. Migrations here are append-only with no downgrade path, so a schema shape that other features will build on is one of these.

If you are unsure, write the ADR. It is a short file, which is far cheaper than an unreviewed architectural mistake the next three years of work is built on.

**Counter-example.** A new screen that reuses an existing page pattern, existing HeroUI components, an existing entity and an existing guard needs **no** ADR. The pattern is already decided. Adding an entry for it adds noise and makes the real decisions harder to find.

## What the ADR adds, and what the spike records

- The **spike** records the outcome `→ ADR` with a one-line reason naming which trigger fired, and lists the questions the ADR has to settle. It does **not** write the ADR.
- The **ADR** records the decision itself: the context and the constraint that forced it, what was chosen, why it fits this repository and this product, the alternatives rejected and why, and the consequences including the ones you did not want. Say what it costs, not only what it buys.
- An ADR that changes an existing decision does not delete the old one. Mark the old entry superseded, with a date and a pointer to the new number. History is the point.
- An ADR that records an exception to a house rule should say, in one line, **what wrong "fix" it exists to prevent**. That line is the whole value of ADR 0013.

## At the outcome step: checklist

1. Apply the escalation test above.
2. **If → SPEC or → PLAN:** record it and move on. The spike is now the source the downstream author writes from.
3. **If → ADR:** record the outcome, write a one-line reason naming the trigger, list the questions the ADR must settle, and stop. Point the author at `docs/DECISIONS/`. Do not start the ADR from inside the spike.
4. Either way, update the feature's row in `docs/features/INDEX.md`.

## Related docs that change with an ADR

An ADR is rarely the only doc that moves. When the decision lands, check whether these are now wrong:

- `ARCHITECTURE.md` (the shape of the system)
- `CLAUDE.md` and `AGENTS.md` (the rules agents follow)
- `docs/API.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md`
- `CHANGELOG.md`, when the change is user-visible

A doc that contradicts a fresh ADR is a bug. Fix it in the same change.
