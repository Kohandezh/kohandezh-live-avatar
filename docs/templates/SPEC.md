# <Feature name>

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Created | YYYY-MM-DD                                     |
| Updated | YYYY-MM-DD                                     |
| Status  | Draft / Approved / Implemented / Superseded    |
| Domain  | auth / assistant / settings / admin / widget / api / infrastructure / ui |
| Targets | mobile / web / admin / widget (list the ones this touches) |
| Author  | <name>                                         |
| Sources | <RESEARCH.md path, ADR, or the pattern this reuses> |

## 1. Purpose

One to three sentences. What exact behaviour is being specified, and why it matters to a
real user.

## 2. Scope

**In scope.** What this spec delivers.

**Out of scope.** Explicit exclusions, phrased as exclusions ("this phase does not support
X"). Point each one at a follow-up when there is one.

## 3. Actors and permissions

Who can do this, and which door they come through:

- a signed-in user (`get_current_user`)
- an admin (`require_admin` on the router)
- an anonymous widget visitor (embed key plus an allowed `Origin`)

Name the real mechanism. Remember the frontend guards (`RequireAuth`, `RequireRole`) are
UX only; the backend enforces.

## 4. User and system flow

The ordered path from trigger to result, per target where they differ. Use a diagram when
the flow has shape rather than prose (see the `diagrams` skill).

## 5. Behaviour

Inputs, outputs, state transitions. Be testable.

Say which system owns each piece of state: TanStack Query (server data), Redux
(client-owned global), or React state (local).

## 6. API contract

Endpoints, request and response shapes, status codes, error codes.

Every new or changed endpoint also lands in `docs/API.md`, the entity's Zod schema, and
`apps/frontend/src/data/mock/handlers.ts`. Any endpoint returning an unbounded collection
defines its paging. Long work answers `202` with a job id.

## 7. Data model and persistence

Tables, fields, indexes, lifecycle. A schema change is a new numbered file in
`apps/api/services/orchestrator/migrations/`, applied in order on startup. Say whether it
is additive. Migrations are append-only: there is no downgrade path.

Update `docs/DATA_MODEL.md` with the code.

## 8. Errors and edge cases

Duplicate request, concurrent request, timeout, partial failure, missing resource, rate
limit reached.

Name the user-facing wording for each, in both `en` and `fa`. An error tells the user what
happened, what they can do, whether retry is safe, and whether their input is kept.

## 9. Security and privacy

Never empty. An empty security section is a red flag at review.

Answer at least: who is authorized and where is that enforced; what is logged and what must
never be logged; where does any token live; what does a public response expose.

## 10. UX states

Fill every line for anything a person sees. "N/A, backend only" is a valid answer for a
backend spec. A blank line is not.

| State | Behaviour |
| ----- | --------- |
| default | |
| loading | |
| success | |
| empty | |
| error (with retry) | |
| disabled | |
| unauthorized (401) | |
| forbidden (403) | |
| offline | |
| partial data | |
| long content / overflow | |
| narrow viewport (phone) | |
| RTL / Persian | |
| accessibility (keyboard, focus, labels, 44px targets) | |

## 11. Compatibility and rollout

Who depends on the current behaviour, and what breaks. Which of the four targets are
affected. Whether a migration or a client update has to land first.

## 12. Acceptance criteria

A checklist of observable outcomes. Each one binary and checkable by a test.

- [ ] ...
- [ ] ...

### Tests

Name the files that will prove it, at the right layer:

- `apps/frontend/tests/unit/...`
- `apps/frontend/tests/integration/...`
- `apps/frontend/tests/e2e/<target>.<topic>.spec.ts`
- `apps/api/services/<service>/tests/test_...py`

## 13. Related artifacts

Research (`RESEARCH.md`), ADR (`docs/DECISIONS/NNNN-*.md`), the Linear issue, the PR.
Put the gate evidence here: the research path, or the one line naming the reused pattern.
