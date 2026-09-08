# ADR 0007 — Generate the API Contract From OpenAPI

## Status

Proposed

## Context

The backend is Python (ADR 0006), so the frontend and the backend cannot share one Zod schema. Today the contract is kept in sync by hand in three places: `docs/API.md`, the entity schema in `apps/frontend/src/entities/<name>/types.ts`, and
`apps/frontend/src/data/mock/handlers.ts`. Hand-syncing drifts. A field the backend renamed shows up as a runtime Zod error, not a build error.

FastAPI already publishes an OpenAPI document at `GET /openapi.json`, generated from the backend's own Pydantic models. It is always correct by construction.

## Decision

Treat the backend's OpenAPI document as the source of truth for the contract. Add one script to this repository that reads it and writes TypeScript types (`openapi-typescript`) or Zod schemas (`openapi-zod-client`) into a generated folder. The generated file is committed, so the build fails when the frontend and the backend disagree.

Accept this ADR when the backend repository publishes its first stable OpenAPI document.

## Consequences

- Entity schemas are generated, not hand-written. Hand-written schemas stay only where the frontend needs a stricter rule than the backend.
- `docs/API.md` becomes a guide to the contract, not its definition. Generate the endpoint table from the same file so it cannot go stale.
- The mock in `apps/frontend/src/data/mock/handlers.ts` stays hand-written. It exists to produce loading, empty, and error states on demand, which a generated stub cannot do.
- Until this ADR is accepted, the current rule holds: a new endpoint means updating `docs/API.md`,
  the entity schema, and the mock handlers together.
- Both sides live in one repository now (ADR 0008), so the generated file and the backend change
  land in the same commit.
