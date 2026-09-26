# Feature index

One row per feature that has a folder under `docs/features/`. Keep it honest: a row saying
`Implemented` for something that is not implemented is worse than no row
(`AGENTS.md`, Documentation Honesty).

Update the row in the same commit as the document it describes.

## Columns

- **Slug** — the folder name under `docs/features/`, lowercase and hyphenated.
- **Spec status** — `Draft`, `Approved`, `Implemented`, `Superseded`. Matches the spec's own header.
- **Research** — `None`, `Open`, `Resolved`. Matches `RESEARCH.md` if there is one.
- **Domain** — `auth`, `assistant`, `settings`, `admin`, `widget`, `api`, `infrastructure`, `ui`. Reuse one rather than inventing another.
- **Targets** — which of `mobile`, `web`, `admin`, `widget` it touches.
- **Created** / **Updated** — `YYYY-MM-DD`.

## Features

| Slug | Spec status | Research | Domain | Targets | Created | Updated |
| ---- | ----------- | -------- | ------ | ------- | ------- | ------- |
| `response-caching` | Approved | Resolved | assistant | mobile, web, admin | 2026-09-19 | 2026-09-26 |

## What goes where

| Kind of document | Home |
| ---------------- | ---- |
| Feature research (a spike) | `docs/features/<slug>/RESEARCH.md`, from `docs/templates/SPIKE.md` |
| Feature spec | `docs/features/<slug>/SPEC.md`, from `docs/templates/SPEC.md` |
| An architectural decision that outlives one feature | `docs/DECISIONS/NNNN-<slug>.md` |
| The API contract | `docs/API.md` |
| The data model | `docs/DATA_MODEL.md` |
| User-visible changes | `CHANGELOG.md` |

A feature folder is for work that needed a written approach before code. Most changes do
not. Do not create a folder to satisfy ceremony.
