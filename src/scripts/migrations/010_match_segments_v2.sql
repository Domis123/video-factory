-- Migration 010: match_segments_v2 candidate retrieval RPC
-- Phase 4 Part B W4: layered-filter candidate retrieval with relaxation + boost scoring.
--
-- Per brief §Filter semantics:
--   Layer 1 (hard): brand_filter, segment_v2 NOT NULL, segment_type <> 'unusable',
--     quality.overall >= min, form_rating <> 'struggling_unsafe', editorial suitability
--     for slot_role <> 'unsuitable'.
--   Layer 2 (soft, relaxation tiers): segment_type -> body_focus -> editorial -> duration.
--     A row's required_tier is the lowest tier at which it qualifies; chosen_tier is
--     the lowest tier whose cumulative count >= target_count; admission = required_tier
--     <= chosen_tier. relaxation_applied annotates the filters each row FAILS (strict-mode),
--     so admitted rows report exactly what they needed relaxed.
--
-- Idempotent per Architecture Rule 22 (DROP FUNCTION IF EXISTS + CREATE + NOTIFY pgrst).
-- STABLE volatility (read-only, result determined by inputs + DB state).
--
-- W4 v1 boost weights are first-pass intuition. Tune during W9 shadow mode with observable
-- retention data. Do NOT auto-tune.
--
-- candidate_multiplier accepted for caller-signature forward-compat; not used at current
-- scale (1116 rows, seq-scan is sub-100ms). Reintroduce as a pool LIMIT if Gate A p95 > 500ms.

DROP FUNCTION IF EXISTS public.match_segments_v2(
  TEXT, TEXT, TEXT[], TEXT[], TEXT, NUMERIC, NUMERIC, UUID, TEXT, INT, INT, INT
);

CREATE FUNCTION public.match_segments_v2(
  query_embedding               TEXT,
  brand_filter                  TEXT,
  segment_type_preferences      TEXT[],
  body_focus_tokens             TEXT[],
  slot_role                     TEXT,
  target_duration_s             NUMERIC,
  duration_tolerance_s          NUMERIC DEFAULT 2.0,
  subject_hint_parent_asset_id  UUID DEFAULT NULL,
  min_form_rating               TEXT DEFAULT 'beginner_modified',
  min_quality_overall           INT DEFAULT 5,
  target_count                  INT DEFAULT 18,
  candidate_multiplier          INT DEFAULT 3
) RETURNS TABLE (
  segment_id                      UUID,
  parent_asset_id                 UUID,
  similarity                      REAL,
  segment_type                    TEXT,
  start_s                         NUMERIC,
  end_s                           NUMERIC,
  clip_r2_key                     TEXT,
  keyframe_grid_r2_key            TEXT,
  description                     TEXT,
  segment_v2                      JSONB,
  matched_body_regions            TEXT[],
  editorial_suitability_for_role  TEXT,
  boost_score                     REAL,
  relaxation_applied              TEXT[]
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  clamped_target_count INT := LEAST(GREATEST(target_count, 5), 30);
  _qvec vector(512)    := query_embedding::vector(512);
BEGIN
  RETURN QUERY
  WITH annotated AS (
    SELECT
      s.id                                          AS _segment_id,
      s.parent_asset_id                             AS _parent_asset_id,
      s.segment_type                                AS _segment_type,
      s.start_s                                     AS _start_s,
      s.end_s                                       AS _end_s,
      s.clip_r2_key                                 AS _clip_r2_key,
      s.keyframe_grid_r2_key                        AS _keyframe_grid_r2_key,
      s.description                                 AS _description,
      s.segment_v2                                  AS _segment_v2,
      (s.embedding <=> _qvec)::real                 AS _cos_distance,

      -- editorial enum for this slot_role (close = best of demo/transition).
      (CASE
        WHEN slot_role = 'hook' THEN
          (s.segment_v2->'editorial'->>'hook_suitability')
        WHEN slot_role = 'body' THEN
          (s.segment_v2->'editorial'->>'demo_suitability')
        WHEN slot_role = 'close' THEN
          CASE
            WHEN (s.segment_v2->'editorial'->>'demo_suitability')       = 'excellent'
              OR (s.segment_v2->'editorial'->>'transition_suitability') = 'excellent' THEN 'excellent'
            WHEN (s.segment_v2->'editorial'->>'demo_suitability')       = 'good'
              OR (s.segment_v2->'editorial'->>'transition_suitability') = 'good'      THEN 'good'
            WHEN (s.segment_v2->'editorial'->>'demo_suitability')       = 'poor'
              OR (s.segment_v2->'editorial'->>'transition_suitability') = 'poor'      THEN 'poor'
            ELSE 'unsuitable'
          END
        ELSE
          (s.segment_v2->'editorial'->>'demo_suitability')
      END)                                          AS _editorial_enum,

      -- matched_body_regions: intersection of body_focus_tokens and segment body_regions.
      CASE
        WHEN body_focus_tokens IS NULL
          OR COALESCE(array_length(body_focus_tokens, 1), 0) = 0
          THEN ARRAY[]::TEXT[]
        ELSE ARRAY(
          SELECT jsonb_array_elements_text(s.segment_v2->'exercise'->'body_regions')
          INTERSECT
          SELECT unnest(body_focus_tokens)
        )
      END                                           AS _matched_regions,

      -- Per-row Layer-2 soft-filter failures (strict mode).
      (CASE
        WHEN COALESCE(array_length(segment_type_preferences, 1), 0) = 0 THEN FALSE
        WHEN s.segment_type = ANY(segment_type_preferences) THEN FALSE
        ELSE TRUE
      END)                                          AS _fails_segment_type,

      (CASE
        WHEN body_focus_tokens IS NULL THEN FALSE
        WHEN COALESCE(array_length(body_focus_tokens, 1), 0) = 0 THEN FALSE
        WHEN (s.segment_v2->'exercise'->'body_regions') ?| body_focus_tokens THEN FALSE
        ELSE TRUE
      END)                                          AS _fails_body_focus,

      (CASE
        WHEN slot_role = 'hook'
          AND (s.segment_v2->'editorial'->>'hook_suitability') IN ('excellent', 'good') THEN FALSE
        WHEN slot_role = 'body'
          AND (s.segment_v2->'editorial'->>'demo_suitability') IN ('excellent', 'good') THEN FALSE
        WHEN slot_role = 'close'
          AND ((s.segment_v2->'editorial'->>'demo_suitability') IN ('excellent', 'good')
            OR (s.segment_v2->'editorial'->>'transition_suitability') IN ('excellent', 'good')) THEN FALSE
        ELSE TRUE
      END)                                          AS _fails_editorial,

      -- Duration strict: tolerance once. Relaxed: tolerance doubled.
      (CASE
        WHEN (s.end_s - s.start_s) BETWEEN (target_duration_s - duration_tolerance_s)
          AND (
            CASE s.segment_type
              WHEN 'hold' THEN 15
              WHEN 'exercise' THEN 12
              ELSE 20
            END + duration_tolerance_s
          ) THEN FALSE
        ELSE TRUE
      END)                                          AS _fails_duration_strict,

      (CASE
        WHEN (s.end_s - s.start_s) BETWEEN (target_duration_s - 2 * duration_tolerance_s)
          AND (
            CASE s.segment_type
              WHEN 'hold' THEN 15
              WHEN 'exercise' THEN 12
              ELSE 20
            END + 2 * duration_tolerance_s
          ) THEN FALSE
        ELSE TRUE
      END)                                          AS _fails_duration_relaxed

    FROM asset_segments s
    WHERE
      -- Layer 1: hard filters (never relaxed).
      s.brand_id       = brand_filter
      AND s.segment_v2 IS NOT NULL
      AND s.segment_type <> 'unusable'
      AND s.embedding  IS NOT NULL
      AND COALESCE((s.segment_v2->'quality'->>'overall')::int, 0) >= min_quality_overall
      AND CASE
        WHEN min_form_rating = 'excellent_controlled' THEN
          COALESCE(s.segment_v2->'exercise'->>'form_rating', 'not_applicable')
            IN ('excellent_controlled', 'not_applicable')
        ELSE
          COALESCE(s.segment_v2->'exercise'->>'form_rating', 'not_applicable')
            <> 'struggling_unsafe'
      END
      -- Editorial 'unsuitable' is hard — never admitted even under relaxation.
      AND CASE
        WHEN slot_role = 'hook' THEN
          COALESCE(s.segment_v2->'editorial'->>'hook_suitability', 'unsuitable') <> 'unsuitable'
        WHEN slot_role = 'body' THEN
          COALESCE(s.segment_v2->'editorial'->>'demo_suitability', 'unsuitable') <> 'unsuitable'
        WHEN slot_role = 'close' THEN
          (COALESCE(s.segment_v2->'editorial'->>'demo_suitability', 'unsuitable') <> 'unsuitable'
            OR COALESCE(s.segment_v2->'editorial'->>'transition_suitability', 'unsuitable') <> 'unsuitable')
        ELSE TRUE
      END
  ),
  tiered AS (
    SELECT a.*,
      (
        CASE WHEN a._fails_segment_type       THEN ARRAY['segment_type']::TEXT[]         ELSE ARRAY[]::TEXT[] END
        || CASE WHEN a._fails_body_focus      THEN ARRAY['body_focus']::TEXT[]           ELSE ARRAY[]::TEXT[] END
        || CASE WHEN a._fails_editorial       THEN ARRAY['editorial_suitability']::TEXT[] ELSE ARRAY[]::TEXT[] END
        || CASE WHEN a._fails_duration_strict THEN ARRAY['duration']::TEXT[]             ELSE ARRAY[]::TEXT[] END
      )                                         AS _relaxation_applied,
      -- required_tier: min tier index at which this row is admissible.
      -- 99 = never (fails even the relaxed duration bound).
      (CASE
        WHEN a._fails_duration_relaxed THEN 99
        WHEN a._fails_duration_strict THEN 4
        WHEN a._fails_editorial       THEN 3
        WHEN a._fails_body_focus      THEN 2
        WHEN a._fails_segment_type    THEN 1
        ELSE                             0
      END)                                      AS _required_tier
    FROM annotated a
  ),
  tier_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE t._required_tier <= 0) AS c0,
      COUNT(*) FILTER (WHERE t._required_tier <= 1) AS c1,
      COUNT(*) FILTER (WHERE t._required_tier <= 2) AS c2,
      COUNT(*) FILTER (WHERE t._required_tier <= 3) AS c3,
      COUNT(*) FILTER (WHERE t._required_tier <= 4) AS c4
    FROM tiered t
  ),
  chosen_tier AS (
    SELECT (
      CASE
        WHEN tc.c0 >= clamped_target_count THEN 0
        WHEN tc.c1 >= clamped_target_count THEN 1
        WHEN tc.c2 >= clamped_target_count THEN 2
        WHEN tc.c3 >= clamped_target_count THEN 3
        ELSE 4
      END
    ) AS t
    FROM tier_counts tc
  ),
  scored AS (
    SELECT t.*,
      ((1.0 - t._cos_distance)
        + 0.15 * (
          CASE
            WHEN body_focus_tokens IS NULL
              OR COALESCE(array_length(body_focus_tokens, 1), 0) = 0 THEN 0.0
            ELSE (COALESCE(array_length(t._matched_regions, 1), 0))::REAL
                  / array_length(body_focus_tokens, 1)
          END
        )
        + 0.10 * CASE t._editorial_enum
          WHEN 'excellent' THEN 1.0
          WHEN 'good'      THEN 0.5
          ELSE 0.0
        END
        + 0.10 * CASE
          WHEN subject_hint_parent_asset_id IS NOT NULL
            AND t._parent_asset_id = subject_hint_parent_asset_id THEN 1.0
          ELSE 0.0
        END
        + 0.05 * (COALESCE((t._segment_v2->'quality'->>'overall')::int, 5)::REAL / 10.0)
        + 0.05 * CASE COALESCE(t._segment_v2->'exercise'->>'form_rating', 'not_applicable')
          WHEN 'excellent_controlled' THEN 1.0
          WHEN 'beginner_modified'    THEN 0.6
          ELSE 0.3
        END
        - 0.20 * COALESCE(array_length(t._relaxation_applied, 1), 0)
      )::REAL                                   AS _boost_score
    FROM tiered t
  )
  SELECT
    sc._segment_id                  AS segment_id,
    sc._parent_asset_id             AS parent_asset_id,
    (1.0 - sc._cos_distance)::REAL  AS similarity,
    sc._segment_type                AS segment_type,
    sc._start_s                     AS start_s,
    sc._end_s                       AS end_s,
    sc._clip_r2_key                 AS clip_r2_key,
    sc._keyframe_grid_r2_key        AS keyframe_grid_r2_key,
    sc._description                 AS description,
    sc._segment_v2                  AS segment_v2,
    sc._matched_regions             AS matched_body_regions,
    sc._editorial_enum              AS editorial_suitability_for_role,
    sc._boost_score                 AS boost_score,
    sc._relaxation_applied          AS relaxation_applied
  FROM scored sc
  WHERE sc._required_tier <= (SELECT t FROM chosen_tier)
  ORDER BY sc._boost_score DESC, sc._segment_id ASC
  LIMIT clamped_target_count;
END;
$fn$;

NOTIFY pgrst, 'reload schema';
