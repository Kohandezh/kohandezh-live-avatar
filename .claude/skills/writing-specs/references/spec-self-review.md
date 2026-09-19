# Spec Self-Review Checklist

Run this after writing the spec and before anyone else reads it. Fix every finding inline. Do not hand over a spec with known gaps.

Section numbers refer to `docs/templates/SPEC.md`, which has 13 sections.

## 1. Placeholder scan

- No "TBD", "TODO", or "fill in later" anywhere in the document.
- No empty template section. All 13 headings have content, even if the content is "N/A, this feature has no UI".
- No vague requirement. "The system should handle errors gracefully" is not a requirement. "A request with no session returns 401, and the screen sends the user to `/login` keeping the attempted path in router state" is.
- If the spec uses ids, no requirement is missing one. `REQ-NNN` functional, `SEC-NNN` security, `US-NNN` user story, `SC-NNN` success criterion, all padded to three digits. Ids are optional on a small spec. Half-applied ids are worse than none.

## 2. Internal consistency

- Section 13 names the gate evidence: the research doc, the ADR, or one line naming the existing pattern this reuses.
- Section 4 (flow) and section 5 (behavior) describe the same thing. A step in one that is missing from the other means one of them is stale.
- Section 6 (API) and section 7 (data model) support the requirements. If a requirement says the export is a CSV download, the endpoint and the storage design have to allow it.
- Every in-scope item in section 2 has at least one requirement that implements it.
- Every out-of-scope item is phrased as an exclusion ("this phase does not support X"), not as a missing capability.
- No requirement contradicts an out-of-scope item.
- Every acceptance criterion in section 12 validates at least one requirement, and every requirement that matters is covered by one.
- Section 9 (security) carries whatever the research found, even when the answer is "no new trust boundary".
- The header table's Status, Domain and Targets match the row you are about to add to `docs/features/INDEX.md`.

## 3. Repo rules the spec cannot spec its way around

These come from `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md` and `docs/SECURITY.md`. A spec that breaks one gets rejected at review, so catch it here.

- **The backend owns authorization.** Section 3 names the real mechanism (`get_current_user`, `require_admin` on the router, or the embed key plus an allowed `Origin`), and says plainly that `RequireAuth` and `RequireRole` are UX only.
- **Layer placement.** Every new piece of code has a home in `app → pages → features/entities → shared`, with no reverse dependency. `shared/` stays domain-agnostic. Admin screens stay under `src/pages/admin/` and reach only the admin router.
- **Target placement.** The spec names which of `mobile`, `web`, `admin`, `widget` it touches. Anything the widget can reach uses no router and no Redux (ADR 0010).
- **One state owner.** Server data goes through TanStack Query, client-owned global state through Redux, everything else stays local. No piece of state is in two systems.
- **One API client.** Every request goes through `src/shared/api`, and every response is parsed with the entity's Zod schema.
- **Pagination.** Any endpoint returning an unbounded collection defines its paging. No route loads a whole table into memory.
- **Contract changes move together.** Section 6 names `docs/API.md`, the entity's Zod schema, and `src/data/mock/handlers.ts` as changing with the code.
- **Migrations are append-only.** A schema change is a new numbered file in `apps/api/services/orchestrator/migrations/`. It never edits a migration that has already run, and there is no downgrade path.
- **One authoritative implementation.** A business rule in the spec is not duplicated in two handlers or two hooks. If it looks like it has to be, the rule belongs one layer down.
- **Tokens.** No token reaches `localStorage` on web, Redux, a URL, or a log. The assistant session token is per-conversation and lives in memory only.

## 4. Product and UX check

From `AGENTS.md`, UI/UX Engineering Standards 1-15. Skip only if nothing in the spec is user-facing.

- Section 10 has a filled line for every state the template asks for: default, loading, success, empty, error with retry, disabled, 401, 403, offline, partial data, long content, narrow viewport, RTL, accessibility.
- Each state names the shared primitive that covers it (`LoadingState`, `EmptyState`, `ErrorState`, `OfflineBanner`, `RequireAuth`), rather than implying a new one.
- Every user-facing string has a key in **both** `en` and `fa`. No hard-coded text, no error code shown to the user, no English-only server message.
- RTL is covered: logical CSS, and Persian text that is longer than the English for the same idea.
- The narrow phone viewport is covered, and touch targets are at least 44px.
- Keyboard operation, focus visibility and accessible labels are answered, not assumed.
- A destructive action has a confirmation and a way back.
- Nothing decorative was added without a purpose (standard 11).
- Every affected target is named, and the spec says what each one shows.

## 5. Scope check

- The spec is deliverable as a realistic set of pull requests, each scoped to one root cause. If it clearly spans two independent areas with separate lifecycles, split it now.
- A large spec groups its requirements into separately mergeable pieces, so the grouping maps onto a stack of one-root-cause PRs (see the `scoped-pr` skill).
- The out-of-scope list captures the exclusions explicitly.
- Open questions: ideally none left. Any that remain are named as risks and accepted deliberately, and the reviewer has to accept them too.

## 6. Ambiguity check

- Every requirement passes the two-interpretation test. Read it again as an implementer who has not seen the research. If it could mean two things, rewrite it so it can only mean one.
- Every acceptance criterion is binary. "The export finishes within 30 seconds for a 10,000-row dataset" is binary. "Exports are reasonably fast" is not.
- Every acceptance criterion is something a test could check. If you cannot picture the Vitest, Playwright or pytest case that fails when it regresses, it is not a criterion yet.
- Section 11 names a real rollout: which existing callers depend on today's behaviour, what breaks, which targets are affected, and whether the backend has to ship before the client.

## After the review

If you found and fixed something, re-scan that one section before committing. Do not re-run the whole checklist, just confirm the fix did not introduce a new inconsistency.

If you found nothing, go to step 7 in the skill: add the row to `docs/features/INDEX.md` in the same commit, then open the pull request.
