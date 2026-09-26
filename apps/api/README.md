# API

The backend. Python with FastAPI (ADR 0006).

## What is here

```text
services/orchestrator/       FastAPI app, schemas, migrations, LiveKit gateway, media probe
services/orchestrator/src/auth/       phone login: one-time codes, session tokens, guards
services/orchestrator/src/auth/asanak.py  sends the login code by SMS (OTP_DELIVERY=asanak)
services/orchestrator/src/assistant/  assistant session tokens: voice agent (Persian) or FULL persona
services/orchestrator/src/library/    the answer library: transition table, admin and user routes
services/orchestrator/src/library_import.py  command: import rendered and not-rendered answers
services/orchestrator/src/library_export.py  command: export ready entries for a render run
services/elevenlabs/         TTS client, PCM validation, deterministic content-addressed cache
services/liveavatar/         LiveAvatar session client, event socket, LITE session manager
```

Imports are rooted at `apps/api`, so modules are `services.orchestrator.src.main` and friends.
The orchestrator image sets `PYTHONPATH=/app` and copies `apps/api/services` to `/app/services`.
It is built and run through the repository-root `docker-compose.yml`, not on its own.

The routes it serves are listed in the root `README.md`. `docs/API.md` describes the starter's
generic contract (auth, pagination, error shape); the avatar routes extend it and use the
enveloped error body described below.

`VITE_API_MOCK=true` still makes the frontend answer the starter's own routes from
`apps/frontend/src/data/mock`. The avatar routes have no mock adapter; their tests use MSW
handlers in `apps/frontend/tests/utils/server.ts`.

## Rules that come from the frontend side

- **Error shape.** The orchestrator returns the enveloped form
  `{ "error": { "code", "message", "retryable", "details" }, "correlation_id" }`. The starter's flat
  form `{ "code", "message", "details"? }` is also accepted. `toApiError` in
  `apps/frontend/src/shared/api/errors.ts` normalizes both, so new endpoints may use either, but
  should stay consistent with the app they belong to. FastAPI's default validation error is
  `{"detail": [...]}` with status `422`, so the exception handler converts it.
- **Sessions.** Web and admin use the HttpOnly cookie `kd_session`. Native sends
  `Authorization: Bearer <token>`. Both carry the same opaque token and resolve to the same
  identity and role check (ADR 0002). See `docs/SECURITY.md`.
- **Authorization.** The frontend guards are UX only. Check the role on every `/api/admin/*` request.
- **Long work.** Answer `202` with a job id and let the client poll. Never hold a request open while
  a model runs. `POST /assets/video/{id}/finalize` does this: it answers `202 {"jobId"}` and a
  `finalize_video` job waits for the MP4 (`docs/API.md`, ADR 0015).
- **CORS.** Cloud installs need explicit web and admin origins with credentials. On-premise installs
  serve both from one origin and need none.

## Already decided

PostgreSQL 16 for metadata and usage, Redis for locks and short-lived session state, SQL
migrations applied on startup from `services/orchestrator/migrations`. Background jobs run in the
API process, from the `generation_jobs` table, with no queue library and no worker service
(ADR 0015, `services/orchestrator/src/jobs/`). Record any further decision as an ADR under
`docs/DECISIONS/` rather than letting a commit decide by accident.

## Answer library import and export

Two commands, run inside the orchestrator container of the install that serves the library, with
its settings and database (`docs/features/response-caching/SPEC.md`, REQ-020 to REQ-029 and
REQ-071). They have no HTTP route. Run every import with `--dry-run` first.

Rendered answers, from a render run's results JSON (one `--results` per wave) and its MP4 files:

```bash
docker compose exec orchestrator python -m services.orchestrator.src.library_import \
  --results /media/import/<batch>/results-wave1.json --results /media/import/<batch>/results-wave2.json \
  --media-dir /media/import/<batch> --avatar-id <avatar the render used> --voice-id <voice it used> \
  --dry-run
```

`--media-dir` is a path inside the container: the compose file mounts the host's `./media` at
`/media`, so copy the files to the host folder `./media/import/<batch>`. Each rendered row becomes
a new `video_assets` row and a `draft` entry; its MP4 is copied to
`VIDEO_CACHE_DIR/LIB_<external_id>.mp4`. The source files are only read. A row whose key has a
`ready` entry saying the same text attaches its video to it, and so does a row whose key has a
`pending` entry with no text or the same text; the pending entry also takes the row's category
fields. The entry must be in the row's language, else the row fails with `language_mismatch`. The render server's `video_asset_id` values are never reused.

Not-rendered answers, from the source JSON, with the rewrite pass's verdict files:

```bash
docker compose exec orchestrator python -m services.orchestrator.src.library_import \
  --source /media/import/<batch>/source.json --language fa \
  --verdicts /media/import/<batch>/batch-1.json --verdicts /media/import/<batch>/batch-2.json \
  --dry-run
```

Every source key without an entry becomes a `pending` entry with no answer text. A `classify` row
takes its key's verdict. The same key may appear in more than one verdict file when the verdicts
agree; verdicts that disagree fail with `duplicate_key`. A key that already has an entry is skipped, so run the results import
first; the other order gives the same entries, apart from what
`import_metadata` records.

A run is all or nothing. If any row fails, nothing is copied or written and the exit status is 1.
The report prints one line per reported row, `file<TAB>key<TAB>reason`, and a summary; it never
prints question or answer text. Failures: `bad_format` (the whole file), `bad_key`, `bad_question`,
`bad_answer`, `bad_answer_original`, `bad_category`, `bad_section_type`, `bad_technical`,
`bad_language`, `bad_video_asset_id`, `bad_duration`, `bad_file`, `file_missing`, `file_exists`,
`external_id_taken`, `duplicate_key`, `duplicate_external_id`, `probe_failed`, `duration_mismatch`,
`answer_text_mismatch`, `language_mismatch`, `write_failed`. Not failures: `not_rendered` (a failed render row, or a
status other than `VIDEO_GENERATED`), `already_imported` (skipped, so a second run changes
nothing) and `attached`. Fix the file and run it again.

The export writes the `ready` entries in the input format of `render_answers.py`, for a render run
on the render server (`apps/api/setup/server/README.md`); import its results as above:

```bash
docker compose exec orchestrator python -m services.orchestrator.src.library_export \
  --out /media/render/answers.json [--key C18Q05 ...]
```

Each row has `key`, `question`, `answer` (the entry's answer text), `category`, `category_title`,
`section_type`, `technical`, `language`, `answer_original`, `batch` and `bridge_type` (null when
the entry has none). With `--key`, a key that is not a `ready` entry is reported `not_ready` and
nothing is written.
