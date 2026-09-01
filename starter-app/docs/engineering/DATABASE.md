# Database (from the frontend's point of view)

**The frontend has no database.** This document exists to make that explicit and to define what
the frontend *does* persist.

| Store | What | Where | Sensitive? |
| --- | --- | --- | --- |
| TanStack Query cache | server state, in memory | `app/queryClient.ts` | cleared on logout |
| Redux | client UI state | `app/store` | never tokens/PII |
| `shared/storage/token.ts` | native access token | Keychain / Keystore | yes — secure only |
| `shared/storage/preferences.ts` | locale, theme, small flags | `localStorage` / Capacitor Preferences | no |
| `src/data/*.json` | static build-time data | bundle | no |
| Service worker cache | app shell assets only | Workbox | never API data |

Rules:
- No schema, no migrations, no ORM in this repository. Backend migrations follow the backend
  repo's rules; the frontend depends only on the API contract.
- Persisting the query cache offline (e.g. `@tanstack/query-persist-client`) is allowed only for
  non-sensitive server data and only with an explicit decision in `DECISIONS.md`.
- Anything that needs multi-user sync, permissions, search, or admin management belongs to the
  backend, not to local storage.
