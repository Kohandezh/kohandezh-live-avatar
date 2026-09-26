-- The columns the in-process job runner needs (ADR 0015, item 2). Additive only: rows written
-- before this migration get the defaults below. max_attempts has a default only so this works on
-- a table that already has rows. The runner sets it per job type on every enqueue.
ALTER TABLE generation_jobs
    ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS worker_id TEXT,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- At most one queued or running job per dedupe_key, so a repeated request gets the job that
-- already exists. A done or failed job does not block a new one. generation_jobs_dedupe_idx from
-- 001 stays.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_active_dedupe_idx
    ON generation_jobs (dedupe_key) WHERE status IN ('queued', 'running');
