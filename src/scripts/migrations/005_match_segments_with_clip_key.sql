DROP FUNCTION IF EXISTS match_segments(TEXT, TEXT, TEXT[], INT, INT);

CREATE OR REPLACE FUNCTION match_segments(
  query_embedding TEXT,
  brand_filter    TEXT,
  type_filter     TEXT[],
  min_quality     INT,
  match_count     INT
) RETURNS TABLE (
  id              UUID,
  parent_asset_id UUID,
  brand_id        TEXT,
  start_s         NUMERIC,
  end_s           NUMERIC,
  duration_s      NUMERIC,
  segment_type    TEXT,
  description     TEXT,
  quality_score   INT,
  clip_r2_key     TEXT,
  distance        FLOAT
) LANGUAGE sql STABLE AS $$
  SELECT
    s.id, s.parent_asset_id, s.brand_id, s.start_s, s.end_s, s.duration_s,
    s.segment_type, s.description, s.quality_score, s.clip_r2_key,
    (s.embedding <=> query_embedding::vector(512))::float AS distance
  FROM asset_segments s
  WHERE s.brand_id = brand_filter
    AND s.segment_type = ANY(type_filter)
    AND s.quality_score >= min_quality
    AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> query_embedding::vector(512) ASC
  LIMIT match_count;
$$;
NOTIFY pgrst, 'reload schema';
