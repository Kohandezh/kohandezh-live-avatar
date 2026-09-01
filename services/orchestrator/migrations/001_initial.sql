CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_session_id TEXT UNIQUE NOT NULL,
    avatar_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode = 'LITE'),
    sandbox BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audio_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key CHAR(64) UNIQUE NOT NULL,
    text TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    language TEXT NOT NULL,
    settings JSONB NOT NULL,
    file_path TEXT NOT NULL,
    duration_ms BIGINT NOT NULL,
    sample_rate INTEGER NOT NULL DEFAULT 24000,
    format TEXT NOT NULL DEFAULT 'pcm_s16le',
    status TEXT NOT NULL DEFAULT 'AUDIO_GENERATED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE NOT NULL,
    text TEXT NOT NULL,
    audio_asset_id UUID REFERENCES audio_assets(id),
    avatar_id TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    video_path TEXT NOT NULL,
    egress_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS generation_jobs_dedupe_idx ON generation_jobs(dedupe_key, status);

CREATE TABLE IF NOT EXISTS provider_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    provider_resource_id TEXT,
    model TEXT,
    characters INTEGER,
    estimated_duration_ms BIGINT,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_usage_time_idx ON provider_usage(occurred_at DESC);
