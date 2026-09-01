# authentication — RESEARCH

**Goal.** A user signs in once per device and stays signed in; the app knows who they are on every
screen; logout is total.

**Existing patterns audited.** None (starter). Establishes the pattern: `useSession()` query is the
single source of truth for "who am I"; `RequireAuth` route guard is UX only.

**States.** unauthenticated · submitting · invalid credentials (401 → `auth.invalid`) · network
error (retryable) · authenticated · session expired mid-use (any `401` → session query set to
`null` via `setUnauthorizedHandler`) · offline (banner; login disabled by network error).

**Decisions.** ADR-002 (dual transport). Password validation client-side is min-length only; the
backend owns the policy.

**Open.** Refresh-token rotation; biometric unlock on native (platform abstraction candidate).
