# CONTRIBUTING

Before opening a PR (this repository uses pnpm, ADR 0009):

```bash
pnpm lint
pnpm build
pnpm test
```

For user-facing workflows, run the e2e tests too:

```bash
pnpm test:e2e
```

A PR is ready when it meets the Definition of Done in `AGENTS.md` (Engineering Standards, section 9). For user-facing changes, also the UI/UX Definition of Done (section 15).

Keep changes focused. Put code in the right target folder or in shared code, not both.

Do not bypass architecture boundaries for convenience.

When you change an endpoint, update `docs/API.md` and `src/data/mock/handlers.ts` together.
The backend is `apps/api/` (ADR 0006). A contract change touches both apps, in one commit.

Add new UI text to both `src/i18n/locales/en` and `src/i18n/locales/fa`.

Update documentation and ADRs when an architectural decision changes.
