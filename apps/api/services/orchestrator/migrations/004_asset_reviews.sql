-- One row per accepted review decision on a recorded asset (ADR 0014, item 5): who decided, what,
-- from which status, and when. No asset text and no phone number: the reviewer is a user id.
-- The row is written in the same transaction as the status change.
--
-- asset_id points at audio_assets or video_assets, picked by asset_kind, so it has no foreign key.
CREATE TABLE IF NOT EXISTS asset_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_kind TEXT NOT NULL CHECK (asset_kind IN ('audio', 'video')),
    asset_id UUID NOT NULL,
    reviewer_user_id UUID NOT NULL REFERENCES users(id),
    decision TEXT NOT NULL,
    previous_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The review history of one asset.
CREATE INDEX IF NOT EXISTS asset_reviews_asset_idx ON asset_reviews(asset_kind, asset_id);
