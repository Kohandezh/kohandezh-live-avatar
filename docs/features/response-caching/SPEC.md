# Response caching for assistant answers

| Field   | Value                                          |
| ------- | ---------------------------------------------- |
| Created | 2026-09-19                                     |
| Updated | 2026-09-19                                     |
| Status  | Draft                                          |
| Domain  | assistant                                      |
| Targets | mobile, web, widget, admin                     |
| Author  | `respcache-t2-res` (Claude Opus 5), mission `20260919-respcache` |
| Sources | `docs/features/response-caching/RESEARCH.md`, Option B (§6). The gate does not pass: see section 13. |

## 1. Purpose

Every answer the assistant gives is generated live, so a repeated question costs full price
every time. The assistant pipeline runs in the browser against LiveAvatar's cloud. Our backend
mints a session token and sees nothing else: no question text, no answer text, no answer media
(`apps/api/services/orchestrator/src/assistant/service.py:50-54`). There is no answer to keep
and no way to serve one again. Caching is not missing from this system, but the one cache that
exists is a deterministic TTS audio cache consulted before the provider is called
(`apps/api/services/elevenlabs/service.py:59-60`), and it sits on the Phase 1 workbench path,
which is not what users talk to (RESEARCH.md §1).

This spec covers a curated library of pre-rendered answers. Staff author a fixed set of
questions in the `admin` target and approve the rendered video. Users reach those answers
through suggested questions on `mobile`, `web` and `widget`, and anything typed or spoken
freely still starts a live session. The library is reached by selection, not by matching
free-text questions, because matching cannot be made safe here on the evidence available: in
production the avatar speaks with a named practitioner's face, so a fluent answer to the wrong
question is attributed to a real person (RESEARCH.md §5.0, §6). The gain is lower provider
cost and a faster answer on the questions asked most. Its size cannot be stated yet, because
`provider_usage` records no per-answer characters or duration for the assistant
(`apps/api/services/orchestrator/src/assistant/service.py:125-140`), so per-answer usage rows
come before the cache rather than after it (RESEARCH.md §4.3).

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

| Artifact | Where | State |
| -------- | ----- | ----- |
| Research | `docs/features/response-caching/RESEARCH.md` | `In Review`, outcome `→ ADR` |
| Pull request | [#18](https://github.com/Kohandezh/kohandezh-live-avatar/pull/18) | open, carries the research |
| ADR | `docs/DECISIONS/0014-conversation-data-retention.md` | does not exist |
| Linear issue | none yet | |

**This spec is partial and blocked. No implementation may begin from it.**

Only the header, section 1 and this section are written. Sections 2 to 12 are still the
template's guidance text. That is deliberate, for three reasons.

1. The request was for the Purpose section alone.
2. The gate for a full spec does not pass. `writing-specs` step 1 requires a settled approach.
   The spike is `In Review`, not `Resolved`, and its outcome is `→ ADR`, not `→ SPEC`. The ADR
   it asks for does not exist. Writing sections 2 to 12 now would invent behaviour on top of an
   approach nobody has decided.
3. The product owner was told the gate does not pass and chose to proceed to the Purpose
   section only. That decision was recorded outside this repository, in the log of mission
   `20260919-respcache`.

The ADR must settle whether a user's question text, the avatar's answer text, or the answer's
media may be persisted at all, and whether media from one user's conversation may be replayed
to another user (RESEARCH.md §8). Option B needs no answer to the first question, because the
questions are staff-authored and no user text is stored. That is half the position. The
authoring endpoints Option B reuses have no authentication today
(`apps/api/services/orchestrator/src/main.py:254,260,280,359,397,436`), and closing them is work
this spec has to carry (RESEARCH.md §5, Option B, C3). The storage boundary still has to be
written down before this spec is filled in, so the next feature does not cross it by accident.

`RESEARCH.md` §8 lists six items of production work, in order. Two of them are worth naming
here. Per-answer `provider_usage` rows on the assistant path, so a saving can be measured at
all. And leaving sandbox mode (`LIVEAVATAR_SANDBOX=false` with a production avatar configured),
because the sandbox avatar is a borrowed public one and sessions are clamped to sixty seconds
(`apps/api/services/orchestrator/src/assistant/service.py:17-18,74-75,221-225`). The other four
are the ADR above, this spec, authentication on the authoring endpoints, and the `202` plus
job-id runner, which means converting `finalize` rather than wrapping it.
