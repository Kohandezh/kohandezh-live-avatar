# Features

| Slug | Status | Layer(s) | Notes |
| --- | --- | --- | --- |
| authentication | starter | features/authentication, shared/api/auth, shared/storage/token | login/logout/session; both transports |
| profile | starter | pages/profile, entities/user | display-name edit, camera demo via platform abstraction |

One folder per feature: `docs/features/<slug>/RESEARCH.md` (problem, existing patterns audited,
states, decisions) created **before** implementation.
