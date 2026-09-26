-- The answer library (docs/features/response-caching/SPEC.md, section 7). Additive only: two new
-- tables, no change to an existing one.
--
-- An entry is staff text: a question, its approved spoken answer, and later its video. Its status
-- is its own lifecycle (pending, ready, draft, published, withdrawn); it never reuses
-- video_assets.status, because the question's review and the media's render are two lifecycles.
CREATE TABLE IF NOT EXISTS library_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL CONSTRAINT library_entries_key_unique UNIQUE
        CHECK (key ~ '^[A-Za-z0-9_-]{1,80}$'),
    question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
    -- The approved spoken text, counted after whitespace normalization. Null only in pending, and
    -- in a withdrawn entry that left from pending.
    answer_text TEXT CHECK (char_length(answer_text) BETWEEN 1 AND 480),
    -- The original answer before the rewrite. Admin reference only, never shown to users.
    answer_original TEXT CHECK (char_length(answer_original) BETWEEN 1 AND 5000),
    language TEXT NOT NULL CHECK (language IN ('fa', 'en')),
    category TEXT NOT NULL,
    category_title TEXT NOT NULL,
    -- Gives the funnel stage of the follow-ups (REQ-077).
    section_type TEXT NOT NULL
        CHECK (section_type IN ('knowledge', 'identity', 'sizing', 'meeting', 'commercial', 'casual')),
    technical TEXT NOT NULL CHECK (technical IN ('technical', 'non-technical', 'classify')),
    import_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    video_asset_id UUID CONSTRAINT library_entries_video_unique UNIQUE REFERENCES video_assets(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'draft', 'published', 'withdrawn')),
    position INTEGER NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    -- No video before draft. A withdrawn entry may have one until the sweep deletes the media.
    CONSTRAINT library_entries_video_by_status CHECK (
        (status IN ('pending', 'ready') AND video_asset_id IS NULL)
        OR (status IN ('draft', 'published') AND video_asset_id IS NOT NULL)
        OR status = 'withdrawn'
    ),
    CONSTRAINT library_entries_answer_by_status CHECK (
        status IN ('pending', 'withdrawn') OR answer_text IS NOT NULL
    )
);

-- The suggestions (REQ-012) and the follow-ups (REQ-077).
CREATE INDEX IF NOT EXISTS library_entries_language_status_idx
    ON library_entries (language, status, position);
CREATE INDEX IF NOT EXISTS library_entries_category_idx
    ON library_entries (category, section_type, status);

-- One row per status change of an entry (ADR 0014, item 5): who, what, when, and no text.
-- Append-only: no code path updates or deletes a row. video_asset_id has no foreign key, so the
-- row keeps the id of a video the sweep deleted, like asset_reviews.asset_id. created_at is the
-- time of the insert (clock_timestamp), not the start of its transaction (now): a change that
-- waited for the entry's row lock happened later, and its row must sort later.
CREATE TABLE IF NOT EXISTS library_entry_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES library_entries(id),
    -- Null when the import attached a video.
    reviewer_id UUID REFERENCES users(id),
    decision TEXT NOT NULL CHECK (decision IN (
        'ready', 'reopened', 'video_attached', 'video_rejected', 'published', 'unpublished', 'withdrawn'
    )),
    video_asset_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- The history of one entry.
CREATE INDEX IF NOT EXISTS library_entry_reviews_entry_idx ON library_entry_reviews (entry_id, created_at);
