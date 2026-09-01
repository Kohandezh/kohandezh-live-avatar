# Engineering Constitution

Non-negotiable principles. Everything else in `docs/engineering/` derives from these. A change that
violates one of them needs an explicit, recorded decision in `docs/engineering/DECISIONS.md` — not
a comment in a PR.

## I. One source of truth
Every kind of data has exactly one owner. Backend-owned data is server state (TanStack Query).
Client-owned data is client state (Redux). Static build-time data lives in `src/data/`. Two
competing copies of the same truth is a bug, not a cache.

## II. The backend owns security
Authorization is enforced server-side, always. The client shapes experience (hide a button, show
a login prompt); it never grants access. Private fields never appear in public responses; public
responses use explicit allowlists. Input validation on the client exists for UX; the backend
validates again.

## III. The frontend never touches the database
All backend communication goes through the API contract and the single API client. The frontend
does not know table names, does not run migrations, and does not depend on backend internals.

## IV. One codebase, isolated platforms
Web, Android, and iOS ship from the same source. Platform differences are confined to
`shared/platform/` and `shared/storage/`. Business logic never asks "am I native?".

## V. Contract first, backward compatible
Frontend and backend are independent systems joined by `docs/api/openapi.yaml`. API evolution is
add → migrate consumers → deprecate → remove. Breaking changes are versioned, never silent.

## VI. Fail explicitly
Loading, empty, error, offline, and unauthorized are first-class states in every data-driven UI.
Errors are normalized, user-readable, and recoverable. Nothing assumes the network is fast, the
request succeeds, or the data exists.

## VII. Simplicity over foresight
Complexity is added only for a present, real requirement. No premature abstraction, no
speculative extensibility, no configuration for what can be auto-detected. Three plain lines beat
a clever helper.

## VIII. Judgment over compliance
Tools, linters, validators, generated code, and even these documents are advisory. An engineer or
agent is expected to challenge a request or a recommendation that harms the user, the
architecture, or security — and to say so plainly with the risk and the alternative.

## IX. UX correctness is feature correctness
A user-facing change is done when the experience is coherent, accessible, responsive, bidirectional
(RTL/LTR), and consistent with the product — not when it compiles.

## X. Docs are code
A document that contradicts the code is a bug. It is fixed in the same change, by whoever finds it.
Target architecture and current state are recorded separately and honestly.
