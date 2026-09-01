# Testing Strategy

CI is the gate (`.github/workflows/ci.yml`). `pnpm check` runs the same locally.

| Level | Tool | What | Where |
| --- | --- | --- | --- |
| Unit | Vitest | pure functions: `shared/api/errors`, `shared/i18n`, utils, reducers | next to the file `*.test.ts` |
| Component | Vitest + Testing Library | `shared/ui/*`, feature components; assert by role/label, not by class | `*.test.tsx` |
| Hook / integration | Vitest + MSW | entity hooks and features against a mocked contract (`msw` is installed) | `src/**/*.test.tsx` |
| Contract | mock-backend smoke | the mock implements `openapi.yaml`; CI curls the tiers | CI job `smoke` |
| E2E | Playwright (add when a product needs it) | critical flows in a real browser | `e2e/` |
| Native | manual + device | camera, push, deep links on real devices before release | release checklist |

Rules:
- Every data-driven component has tests for loading, empty, error, and data states.
- Tests use accessible queries (`getByRole`, `getByLabelText`). If a test cannot find an element
  by role/label, the component has an accessibility bug.
- No test hits a real network. Use MSW or the mock backend.
- A bug fix ships with a failing-then-passing test.
- Tests are not the place to encode the current visual design; snapshot tests are discouraged.
