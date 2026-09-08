# ADR 0005 — Mock API Through an Axios Adapter

## Status

Accepted

## Context

The frontend depends on an API contract, but the backend is often not available on a developer machine or in CI. Screens must still show real loading, success, empty, and error states.

## Decision

`src/data/mock` implements the API contract in memory and plugs into the single axios client as a custom adapter (`installMockApi`). It is enabled with `VITE_API_MOCK=true`, loaded on demand in `src/app/bootstrap.ts`, and never included in a normal production bundle.

Playwright e2e tests and Vitest integration tests run against this mock.

## Alternatives

- Mock Service Worker (MSW): more realistic, but a new dependency and a service worker in the mobile shell.
- Hard-coded data in components: hides the loading and error states we want to test.

## Consequences

- The mock must follow `docs/API.md`. When the contract changes, update both.
- Mock sessions live in `localStorage` under `mock_session_user_id`. This stands in for the cookie or token and is not security.
- `VITE_API_MOCK` must be `false` (or unset) in staging and production.
