CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE asset_segments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  brand_id              TEXT NOT NULL,
  segment_index         INT  NOT NULL,                    -- ordinal within parent
  start_s               NUMERIC(7,3) NOT NULL,            -- trim window start in source
  end_s                 NUMERIC(7,3) NOT NULL,            -- trim window end in source
  duration_s            NUMERIC(7,3) GENERATED ALWAYS AS (end_s - start_s) STORED,

  description           TEXT NOT NULL,                    -- one rich sentence
  visual_tags           TEXT[] NOT NULL DEFAULT '{}',     -- 5–10 tags
  best_used_as          TEXT[] NOT NULL DEFAULT '{}',     -- ['b-roll','demo','hook','transition','establishing']
  motion_intensity      INT  NOT NULL CHECK (motion_intensity BETWEEN 1 AND 10),
  recommended_duration_s NUMERIC(5,2),                    -- editor's hint, not enforced
  has_speech            BOOLEAN NOT NULL DEFAULT false,
  quality_score         INT  CHECK (quality_score BETWEEN 1 AND 10),

  keyframe_r2_key       TEXT,                             -- R2 path to extracted JPG
  embedding             VECTOR(512),                      -- CLIP ViT-B/32 = 512 dims

  ingestion_model       TEXT NOT NULL,                    -- e.g. 'gemini-2.5-pro'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(parent_asset_id, segment_index)
);

CREATE INDEX asset_segments_brand_idx       ON asset_segments(brand_id);
CREATE INDEX asset_segments_parent_idx      ON asset_segments(parent_asset_id);
CREATE INDEX asset_segments_embedding_idx
  ON asset_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Permissive RLS to match existing pattern
ALTER TABLE asset_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all on asset_segments" ON asset_segments
  FOR ALL TO anon USING (true) WITH CHECK (true);
