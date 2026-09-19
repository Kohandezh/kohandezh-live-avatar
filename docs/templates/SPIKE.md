# Spike: <the one question>

| Field   | Value                                      |
| ------- | ------------------------------------------ |
| Created | YYYY-MM-DD                                 |
| Updated | YYYY-MM-DD                                 |
| Status  | Open / Resolved                            |
| Domain  | auth / assistant / settings / admin / widget / api / infrastructure / ui |
| Author  | <name>                                     |
| Outcome | → SPEC / → ADR / → PLAN / → no action      |

## 1. The question

One question, stated so it can be answered yes or no, or "A or B". If you need two
questions, you need two spikes.

## 2. Why it is open

What is genuinely unknown, and what it would cost to guess wrong.

## 3. Constraints

What any answer has to satisfy: the four targets, RTL, offline, the layer boundaries, the
security rules, bundle size, provider cost, on-premise installs.

## 4. What the codebase already does

Verified against the code, with file paths. This comes **first**, before any outside
research: the answer is often already in the repo.

## 5. Options

### Option A: <name>

- **How it works.**
- **Evidence.** Links, versions, dates, and what you actually ran or read.
- **Fits the constraints?** Per constraint from section 3.
- **Cost.** Work, dependencies, risk, what it makes harder later.

### Option B: <name>

Same shape.

## 6. Recommendation

The option, and the one reason that decides it. Name the trade-off you are accepting.

## 7. Assumptions not verified

Tag anything you believe but did not check. A later spec must verify one of these before
promoting it into a requirement.

## 8. Outcome

One of:

- **→ SPEC.** The approach is settled. Write `docs/features/<slug>/SPEC.md`.
- **→ ADR.** The decision outlives this feature. Add `docs/DECISIONS/NNNN-<slug>.md`.
- **→ PLAN.** The approach was never in doubt; it only needed sequencing.
- **→ no action.** The question dissolved. Say why, so nobody reopens it.
