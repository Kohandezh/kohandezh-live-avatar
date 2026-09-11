-- Phone login and the FULL mode assistant session.
-- Users are created on the first successful one-time code check. There is no password column,
-- because the phone plus the one-time code is the only credential.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The admin list is ordered by newest first and the dashboard counts new users by week.
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at DESC);

-- Phase 1 only wrote LITE sessions. The assistant writes FULL sessions into the same table.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_mode_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_mode_check CHECK (mode IN ('LITE', 'FULL'));

-- Nullable: widget sessions have no user, and every Phase 1 row predates the users table.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- SHA-256 of the provider session token. The raw token stays in memory only, so a database
-- dump cannot be used to drive somebody else's live session.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_token_hash TEXT;

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, started_at DESC);
