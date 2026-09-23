# 0015. Background jobs

Status: Proposed
Date: 2026-09-24

## Context

The API cannot run work after a request ends. It is one uvicorn process
(`apps/api/services/orchestrator/Dockerfile:28`) with no worker service beside it
(`docker-compose.yml:91-127`). The only background work is `asyncio.create_task` inside the API
(`apps/api/services/liveavatar/manager.py:137`, `apps/api/services/liveavatar/connection.py:37`).
Redis is locks and rate limits, not a queue (`.../src/coordination.py:30-107`). A duplicate job
gets `409` (`coordination.py:35-36`, `.../src/errors.py:36-38`).

Four facts force a decision now:

- `docs/API.md:20-22` says long work answers `202` with a job id, polled at `GET /api/jobs/{jobId}`.
  That endpoint does not exist (§4.1 row 5).
- `finalize` holds its request open up to fifteen seconds, thirty sleeps of half a second
  (`.../src/main.py:406-409`). It breaks that rule today (`RESEARCH.md:1140`).
- `generation_jobs` was shaped for a runner (`.../migrations/001_initial.sql:55-68`), but no code
  uses it (§4.1 row 5). It has no attempt count, lease or worker id (`RESEARCH.md:1081-1082`).
- ADR 0014 writes no draft until a job enforces the 30 days (`0014:53-54`). B's and E's render
  jobs need a runner too (§8, production item 7).

The spike (`docs/features/response-caching/RESEARCH.md`, "§" below) sent the question here
(`RESEARCH.md:1434-1436`) and picked an in-process runner, "a choice for simplicity, not a
constraint" (`RESEARCH.md:1079-1080`). ADR 0014 lists what this record settles (`0014:224-230`).

This record is **Proposed**. The owner accepts, edits or rejects each item. "Owner decision" marks
what only the owner can settle, with a default that is not a decision. Code is cited at `536be20`
(identical to `main@eb05da0`). `.../` is `apps/api/services/orchestrator/`.

## Decision

Job payloads are storage. `input` and `output` are JSONB (`001_initial.sql:62-63`). They reference
rows by id and carry no conversation text beyond what ADR 0014 items 1 to 3 allow. `error_message`
is a fixed message per `error_code`, never user text. A job reads its text from the row it names.

### 1. The runner

**Decision.** An in-process runner inside the API runs jobs from `generation_jobs`. It starts with
the app and claims the next due job by a conditional update that sets its lease (item 2). Three job
types to start: `finalize_video` (item 4), `retention_sweep` (item 5), `render_video` (item 3). A
render job owns a LITE session, and sessions live in the API process's memory
(`manager.py:53,137-139`), so the job runs next to them. Volume is low (`RESEARCH.md:1083-1084`).

**Rejected:** a queue library and a worker process. `arq` is asyncio-native and Production/Stable
(0.28.0, PyPI, fetched 2026-09-23, §5 Option E). It still adds a dependency, a process, a container,
and a queue role for Redis, which `apps/api/README.md:47` limits to locks and short-lived state. A
worker could own a whole LITE session, as a second copy of the session code for a short, rare job
(`RESEARCH.md:1067-1076`). BullMQ's Python package is Alpha (3.2.6, PyPI, fetched 2026-09-23).

**Owner decision:** default proposed is the in-process runner and no new dependency. A queue
library comes only if the owner says so. One `render_video` runs at a time per install, because
plan limits on concurrent sessions are unverified (U18, `RESEARCH.md:1356`).

### 2. Who owns job state

**Decision.** `generation_jobs` in PostgreSQL is the only owner of job state. Redis holds none.
`status` takes the four values of `docs/API.md:21`: `queued`, `running`, `done`, `failed`. One new
append-only migration (C4, `RESEARCH.md:97`) adds these columns. This record does not write it.

| Column | Purpose |
| ------ | ------- |
| `attempt_count INT NOT NULL DEFAULT 0` | attempts started so far |
| `max_attempts INT NOT NULL` | the retry limit, set per job type at enqueue (item 3) |
| `run_after TIMESTAMPTZ NOT NULL DEFAULT now()` | when the job is next due: backoff and schedules |
| `lease_expires_at TIMESTAMPTZ` | a `running` job past its lease is dead |
| `worker_id TEXT` | the process holding the lease: host name plus a per-boot random id |
| `created_by UUID REFERENCES users(id)` | who asked; null for system jobs (item 4) |
| `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` | last change |

It also adds a unique index on `dedupe_key` over `queued` and `running` rows, so a repeat request
gets the existing `jobId`. The running job renews its lease while it works. The runner writes
`error_code` and `error_message`, which nothing writes today (`RESEARCH.md:1494-1498`).

**Rejected:** a Redis lock as the lease. It expires after 60 seconds by default (`coordination.py:31`),
a render can run ten minutes (`infra/livekit-egress/egress.yaml:17-18`), and it keeps no failure.

**Owner decision:** default proposed is that `done` and `failed` rows are kept 30 days, then item
5 deletes them (ids only, so housekeeping, not privacy). The lease is 60 seconds, renewed every 20.

### 3. Retry after the process dies

**Decision.** When the process dies, its jobs stay `running` and their leases lapse. The runner
then reclaims each one: `attempt_count` goes up by one and the job returns to `queued`, or becomes
`failed` with `error_code` `worker_lost` at `max_attempts`. `finalize_video` and `retention_sweep`
are safe to run twice: one checks the file again, the other deletes by age.

A `render_video` job cannot resume. Its LITE session lived in the dead process's memory
(`manager.py:53`), and the provider ends it on its five-minute idle timeout (LiveAvatar LITE events
page, cited at `RESEARCH.md:1356`). So a retry is a new attempt: a new session, a new `video_assets`
row and a new Egress recording. It cannot reuse the old row, because `generate-video` refuses an
asset that already has an Egress id (`.../src/main.py:374-380`). On reclaim the runner stops the old
Egress by its stored id (`main.py:393,404`), sets the old row to `REJECTED`, and deletes its file.
The next attempt waits five minutes (`run_after`), so the old session has ended at the provider.

**What keeps a half-rendered asset invisible.** A new row starts `DRAFT` (`.../src/database.py:134`)
and becomes `VIDEO_GENERATED` only after the MP4 passes the probe (`main.py:414-415`,
`database.py:157-161`). Only `VIDEO_APPROVED` is ever matched or shown to a user. Two gaps close
before any render job runs. Approval sets a status without checking the current one
(`database.py:171-182`, `main.py:444-458`), so it must require `VIDEO_GENERATED`. And
`GET /assets/video/{id}` serves any row whose file exists, whatever its status (`main.py:436-441`),
so the user-facing route must serve `VIDEO_APPROVED` only. Only admins see a failed job.

**What the spike could not verify.** U18 is partly verified: the code path exists
(`manager.py:56-190`), and plan limits differ between LiveAvatar's pages (`RESEARCH.md:1356`). The
spike has no evidence on what Egress does once the publisher disappears; stopping it by id covers
either case, and the ten-minute file limit bounds it (`egress.yaml:18`). So `render_video` waits:

- **Meanwhile:** the runner ships with `finalize_video` and `retention_sweep` only. Renders stay
  the manual workbench flow (`apps/frontend/src/features/recording/useRecording.ts:57`).
- **Precondition:** one render job run outside production, with U4, as U18 says. It is paid, so
  the owner approves it, and the Option B spec runs it.
- **If it holds,** `render_video` ships with the defaults below. **If not,** renders stay manual,
  and if the account allows one session at a time, the B spec schedules renders around live users.

**Rejected:** resuming on the old session. Its handle and keepalive died with the process
(`manager.py:137-139`), and a new WebSocket replaces the old (`RESEARCH.md:1356`).

**Owner decision:** default proposed is `max_attempts` 3 for `render_video` (two retries, five
minutes apart) and for `finalize_video`. `retention_sweep` is rescheduled anyway (item 5). Each
render retry is a new paid LITE session at 1 credit per minute (§8, "What does one render cost?").

### 4. `GET /api/jobs/{jobId}` and `finalize`

**Decision.** `GET /api/jobs/{jobId}` returns the shape in `docs/API.md:20-21`: `status`, `result`
from `output` when `done`, `error` from `error_code` and `error_message` when `failed`. The caller
is the job's `created_by` user or an admin (`require_admin`, `.../src/auth/dependencies.py:57-60`),
and a system job is admin only. Anyone else gets `404`. The mock gets the route (`RESEARCH.md:1083`).

`POST /assets/video/{asset_id}/finalize` is **converted, not wrapped** (`RESEARCH.md:1472-1474`).
It stops Egress (`main.py:404`), enqueues `finalize_video`, and answers `202` with the `jobId`. The
request waits for nothing. The job checks for the file; if it is missing, it sets `run_after` a few
seconds ahead and releases the lease instead of sleeping. When the file appears, it probes it and
marks the row `VIDEO_GENERATED` (`main.py:414-415`). If it never appears, the job fails with the
existing `egress_failure` code (`main.py:411-412`). The wait survives a restart, and the failure
stays in a row an admin can read, not in a `502` that is gone.

**Rejected:** wrapping the loop in `asyncio.create_task`. It sleeps, dies on restart, has no poll.

**Owner decision:** default proposed is that the file wait gives up after 60 seconds in total, four
times today's fifteen. Egress writes the file after the stop, and the spike has no measurement of
how long that takes. The client's poll interval and timeout are the spec's.

### 5. The deletion job

**Decision.** The same runner runs ADR 0014 item 1's scheduled deletion, as `retention_sweep` with
a fixed `dedupe_key`. On startup the runner enqueues it if none is queued. Each run deletes what has
passed its period, then enqueues the next run one day ahead. It deletes drafts past 30 days
(`0014:58`), `done` and `failed` jobs past item 2's period, and a withdrawn or replaced MP4 with its
row (`0014:60`). The draft and media periods are ADR 0014's; this record does not change them.

ADR 0014's gate holds until then:

- **Meanwhile:** no draft is written (`0014:53-54`). Nothing stores user text today
  (`.../src/assistant/service.py:50-54`), so nothing needs deleting.
- **Precondition:** the owner accepts ADR 0014 and this record. The phase 2 spec builds the sweep's
  draft part, with a test that an expired draft is gone after one run.
- **Either way:** if the owner picks a queue library in item 1, the sweep becomes its scheduled
  job and the gate is the same. If the owner rejects stored drafts, the sweep deletes jobs and
  withdrawn media only.

**Rejected:** a cron container or a database scheduler extension, a new process or dependency.
And hiding old drafts in queries: the text still sits in the table, which is storage (`0014:40`).

**Owner decision:** default proposed is one sweep a day: a draft outlives its 30 days by a day at most.

## Consequences

**What it buys.** C5 holds (`RESEARCH.md:98`). ADR 0014 item 1 gets its deletion job. B and E get
a render path with a retry and a failure record. No dependency or process is added, so no-internet
installs (C7, `RESEARCH.md:100`) ship the same image as today.

**What it costs.**

- Jobs share a process with requests. Retry covers a crash, not load: fine while approvals are rare.
- Every render retry is a paid session, and a failed render wastes its minutes.
- The migration is one-way (C4). The runner is code we own: claiming, leases, backoff, tests.
- `finalize` answers `202`, not `200` with the asset. The workbench polls (`useRecording.ts:57`,
  `apps/frontend/src/shared/api/assets.ts:39-42`), and its test changes (`useRecording.test.tsx:37`).

**Work this unblocks.** §8 production item 7 (`RESEARCH.md:1472-1474`). ADR 0014 item 1's deletion
job, and so E's phase 2 (§8, production item 8). B's and E's render jobs, once U18 holds and
production items 2, 3 and 6 are done.

**Documents that change on acceptance.**

- `docs/DATA_MODEL.md` gains `generation_jobs` with its columns and statuses, and the `video_assets`
  statuses with who may see each. It documents neither today (`RESEARCH.md:1512-1514`).
- `docs/API.md` gains `GET /api/jobs/{jobId}` with its access rule, and `finalize`'s `202`.
- `apps/frontend/src/data/mock/handlers.ts` gains the jobs route (`RESEARCH.md:1083`).
- `apps/api/README.md:45-49`, "Already decided": jobs run in the API over `generation_jobs`.
- A new migration after `003_birth_date.sql` adds item 2's columns and index.

**The wrong fix this prevents.** A reviewer sees a polling loop over a table, reads
"Production/Stable" next to `arq`, and swaps in a queue and a worker container: a dependency the
owner did not approve, away from the LITE sessions the jobs own (`manager.py:53`). Or retries a
render on the same asset row, where a half-written recording could be approved.
