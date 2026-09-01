# AGENTS.md — Standing rules for any agent (human or AI) working in this repository

These rules are permanent. `CLAUDE.md` tells you *how to execute* in this repo; this file tells you
*what standard the result must meet*. When they conflict, this file wins. When either conflicts
with the code, the doc is wrong — fix the doc in the same change.

Read order for a new session: `CLAUDE.md` → this file → `ENGINEERING_CONSTITUTION.md` →
`docs/engineering/ARCHITECTURE.md` → the doc for the layer you are about to touch.

---

## 1. Engineering Judgment

You are not a request executor. You are expected to:

- Preserve the **intended user outcome**, not necessarily the requested implementation.
- Challenge a request that is awkward, insecure, inconsistent with the architecture, or
  unnecessarily complex. Say what is wrong, what the risk is, and what you propose instead.
- Refuse to fake completion. A feature that compiles but has no empty/error state, no test, or no
  UX review is not done.
- Treat tool output (linters, UI/UX validators, generated code, this file) as **advisory**. Apply
  judgment; do not blindly obey a tool that conflicts with the design system, accessibility,
  platform conventions, or the actual user workflow.

## 2. Avoid Over-Engineering

- No abstraction, infrastructure, feature flag, config option, or extensibility for a
  hypothetical future requirement. Build for the requirement in front of you.
- Three similar lines beat a premature helper. A new file/module/hook must justify its existence.
- Do not add a dependency when 20 lines of code do the job.
- Do not create separate Web / Android / iOS code paths before checking whether one shared
  abstraction in `shared/platform/` satisfies the need (Architecture Rule 6).
- Complexity is added only when a real, present requirement demands it (Architecture Rule 9/10).

## 3. STOP CONDITIONS — halt and ask before continuing

Stop, state the problem, and wait for a decision when any of these is true:

1. The task requires the frontend to talk to a database, bypass the API client, or store a
   secret in the bundle.
2. The task requires a breaking change to the API contract (`docs/api/openapi.yaml`) that is
   not versioned or coordinated.
3. Security-sensitive authorization would be enforced only on the client.
4. A native token would be stored outside secure platform storage.
5. The requested UI contradicts an established product pattern and you cannot reconcile them.
6. The change touches auth, sessions, tokens, or CORS — do a security review before calling it done.
7. A migration, deploy, or irreversible data operation is involved.
8. You would need to invent facts (an endpoint, a field, a threshold) that no doc or code defines.
9. Two docs disagree and you cannot tell which is current.
10. The estimated change is > ~400 lines or touches > 3 layers; split it or get agreement first.

## 4. Phase Workflow (every non-trivial task)

```
Requirement → Existing-code audit → Architecture check → Interaction design →
Implementation → States (loading/empty/error/offline/unauthorized) →
Tests → UI/UX validation → Browser/device verification → Self-review → Docs update
```

- **Audit before writing.** Search for existing components, hooks, API functions, tokens.
- **Architecture check.** Which layer owns this? Server state → TanStack Query. Client state →
  Redux. Platform difference → `shared/platform`. Backend call → `shared/api`.
- **Self-review** means reading your own diff as a hostile reviewer, then running `pnpm check`.
- **Docs update** is part of the change, not a follow-up (see `CLAUDE.md` → Documentation Rules).

## 5. Architectural Rules (binding — full text in `docs/engineering/ARCHITECTURE.md`)

1. One source of truth per kind of data.
2. Server state ≠ client state. Backend-owned data lives in TanStack Query, never Redux.
3. Backend owns security. The client never enforces security-sensitive authorization.
4. Platform isolation: Web/Native differences live behind `shared/platform/` and `shared/storage/`.
5. Explicit data exposure: public API responses use field allowlists.
6. Shared code first: one codebase for Web, Android, iOS.
7. No direct database access from the frontend. Ever.
8. API contract first: depend on `docs/api/openapi.yaml`, not backend internals.
9. Prefer simplicity. 10. No premature abstraction. 11. Explicit ownership. 12. Fail explicitly.

## 6. Layer Boundaries (enforced by ESLint)

```
app  →  pages  →  features  →  entities  →  shared
```

A layer may import only from layers to its right. `shared/` imports nothing above it. `pages/`
compose; they do not hold business logic. Only `shared/api/client.ts` may call `fetch`.

## 7. UI/UX Engineering Standards

UI/UX is part of the engineering work, not a cosmetic layer added after implementation. When you
implement or modify user-facing functionality, do not only make it technically work. The result
must be coherent, accessible, responsive, predictable, and consistent with the existing design
language.

### 7.1 Understand before designing
Inspect existing screens and components, identify the design system and component patterns,
reuse existing components, inspect similar features already in the repo, understand the user's
workflow and the feature's purpose. Do not invent a new interaction pattern when an established
one exists. Extend the product's UX language; do not build an isolated mini-product.

### 7.2 UX before UI
For every user-facing feature, answer: What is the user's goal? What is the primary action? What
information do they need? What happens before, during, and after the action? With no data? While
loading? On failure? On success? With partial data? On repeated actions? When they navigate away
and return? Do not design only the happy path.

### 7.3 State completeness
Consider at minimum: initial, loading, success, empty, error, disabled, partial-data,
permission/access, offline/network failure, long-content, high-volume data. A UI is not complete
when only the successful state looks good. Use `shared/ui/AsyncState` so no screen forgets one.

### 7.4 Interaction design
Interactions must be predictable, discoverable, reversible where appropriate, consistent with
existing product behavior, appropriately prioritized, and resistant to accidental actions. Prefer
established patterns over novel ones unless there is a clear UX reason.

### 7.5 Visual design
Follow the design tokens in `shared/ui/styles.css` for typography, spacing, colors, borders,
radii, shadows, icons, dimensions, hierarchy, responsive behavior, motion. Do not introduce
arbitrary values when a token exists. Do not build an impressive component that is inconsistent
with the rest of the product.

### 7.6 Accessibility (part of correctness)
Keyboard navigation, focus states, semantic elements, accessible labels, contrast, touch target
size (≥ 44px), screen-reader behavior, reduced-motion preference, understandable and discoverable
error messages.

### 7.7 Responsive and bidirectional
Do not assume one viewport: desktop, tablet, mobile, narrow, large, long content, text expansion.
Do not assume LTR or RTL — the document root carries `dir`; use logical CSS properties
(`margin-inline-start`, not `margin-left`).

### 7.8 Feedback and perceived performance
Immediate visual feedback, loading indicators, optimistic updates where safe, disabled states,
progress for long operations, success confirmation, meaningful error feedback. A spinner is not a
substitute for understanding the operation. No animations that delay or obscure the task.

### 7.9 Error UX
Errors must help users recover. Never expose raw technical errors. Communicate: what happened,
what the user can do, whether retrying is safe, whether their input was preserved.

### 7.10 Notifications and interruptive UI
Decide whether the information actually requires interruption; prefer the least disruptive
mechanism; distinguish info/success/warning/error; no spam or duplicates; understandable without
relying only on color or icons; consider persistence, dismissal, read/unread, navigation, volume,
and the empty/loading/error/pagination states. A notification system is a product-wide UX system,
not a list component.

### 7.11 Validation
Before a UI task is complete, review visual consistency, layout and spacing, hierarchy,
interaction clarity, responsive behavior, accessibility, loading/empty/error states, feedback,
consistency with existing patterns, unnecessary complexity, and visual regressions. Use the
project's approved UI/UX validation tooling (e.g. UI/UX Pro Max) when available. **Tool output is
advisory, not authoritative** — reject a recommendation that conflicts with the design system,
accessibility, platform conventions, technical constraints, established patterns, or the actual
workflow, and say why.

### 7.12 Visual verification
Run the app, walk the affected workflow, inspect the states, test the interactions, check
responsive layouts, check for regressions. Compiling is not verification.

### 7.13 Reuse before creating / 7.14 Do not over-design
Search for existing components, patterns, tokens, hooks first. No unnecessary animations,
decorative elements, gradients, shadows, modals, notifications, or complicated interactions.
"Premium" does not mean visually complicated; the best UI makes the task feel obvious.

### 7.15 UI/UX Definition of Done
Primary workflow works · existing patterns respected · relevant states implemented · responsive
considered · accessibility considered · errors understandable and recoverable · feedback
appropriate · existing components/tokens reused · visually and interaction reviewed · approved
validation process used when applicable · verified in the running app when practical.
**UI correctness is part of feature correctness.**

## 8. Definition of Done (engineering)

- `pnpm check` passes (typecheck, lint, format, tests).
- New behavior has tests at the right level (`docs/engineering/TESTING.md`).
- Loading / empty / error / offline / unauthorized states exist where data is involved.
- No new raw `fetch`, no new Redux state for server data, no platform API outside `shared/platform`.
- API changes are reflected in `docs/api/openapi.yaml` and are backward compatible or versioned.
- Decisions recorded in `docs/engineering/DECISIONS.md`; docs updated per `CLAUDE.md`.
- UI/UX Definition of Done (§7.15) met for anything user-facing.
