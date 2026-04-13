-- NOTE: An ivfflat index on asset_segments(embedding) was originally created
-- in migration 001 with `lists = 50`. It was dropped on 2026-04-13 because at
-- ~182 rows the index cells were too small to return useful candidates for
-- text-derived query embeddings. Sequential scan is fast enough at this scale.
-- Recreate the index when asset_segments hits ~1000 rows, with `lists ≈ rows / 1000`.

CREATE OR REPLACE FUNCTION match_segments(
  query_embedding VECTOR(512),
  brand_filter TEXT,
  type_filter TEXT[],
  min_quality INT,
  match_count INT
) RETURNS TABLE (
  id UUID,
  parent_asset_id UUID,
  brand_id TEXT,
  start_s NUMERIC,
  end_s NUMERIC,
  duration_s NUMERIC,
  segment_type TEXT,
  description TEXT,
  quality_score INT,
  distance FLOAT
) LANGUAGE sql STABLE AS $$
  SELECT
    s.id, s.parent_asset_id, s.brand_id, s.start_s, s.end_s, s.duration_s,
    s.segment_type, s.description, s.quality_score,
    (s.embedding <=> query_embedding)::float AS distance
  FROM asset_segments s
  WHERE s.brand_id = brand_filter
    AND s.segment_type = ANY(type_filter)
    AND s.quality_score >= min_quality
    AND s.embedding IS NOT NULL
  ORDER BY s.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;
