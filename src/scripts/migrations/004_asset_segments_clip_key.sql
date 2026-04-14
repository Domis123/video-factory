ALTER TABLE asset_segments ADD COLUMN clip_r2_key TEXT;
CREATE INDEX asset_segments_clip_key_idx ON asset_segments(clip_r2_key) WHERE clip_r2_key IS NOT NULL;
