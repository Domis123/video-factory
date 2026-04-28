/**
 * Cooldown tracker — read/write helpers for simple_pipeline_render_history.
 *
 * Two read shapes:
 *   - getRecentParentsUsed(brand, format, limit=2) — last N distinct parents
 *     used on the routine path for a brand. Used to feed Match-Or-Match's
 *     `excludedParents` input.
 *   - getRecentSegmentsUsed(brand, limit=2) — last N distinct segments used
 *     for any format on the brand. Used to feed Match-Or-Match's
 *     `excludedSegments` input. Format-agnostic because both routine and
 *     meme should avoid recently-used segments regardless of which format
 *     used them last.
 *
 * One write shape:
 *   - logRender(...) — inserts one row per segment picked. Routine path
 *     inserts 2-5 rows (one per segment, all with the same parent_asset_id
 *     and job_id). Meme path inserts 1 row.
 *
 * File: src/orchestrator/simple-pipeline/segment-cooldown-tracker.ts
 */

import { supabaseAdmin } from '../../config/supabase.js';

export type SimplePipelineFormat = 'routine' | 'meme';

export interface LogRenderInput {
  brandId: string;
  format: SimplePipelineFormat;
  parentAssetId: string;
  segmentIds: string[]; // length 1 (meme) or 2-5 (routine)
  jobId: string | null;
}

/**
 * Returns up to `limit` distinct parent_asset_ids most-recently used on the
 * given format for this brand, ordered most-recent-first.
 *
 * Implementation: pulls the most-recent N×3 rows (over-fetch budget), then
 * dedupes parent_asset_id client-side preserving created_at order. Avoids
 * the GROUP BY + ORDER BY MAX(created_at) round-trip that PostgREST doesn't
 * expose ergonomically.
 */
export async function getRecentParentsUsed(
  brandId: string,
  format: SimplePipelineFormat,
  limit = 2,
): Promise<string[]> {
  if (limit < 1) return [];
  // Over-fetch: a single routine job inserts up to 5 rows for one parent,
  // so to get 2 distinct parents we may need to look back ~10+ rows.
  const overFetch = Math.max(limit * 8, 16);

  const { data, error } = await supabaseAdmin
    .from('simple_pipeline_render_history')
    .select('parent_asset_id, created_at')
    .eq('brand_id', brandId)
    .eq('format', format)
    .order('created_at', { ascending: false })
    .limit(overFetch);

  if (error) {
    throw new Error(`getRecentParentsUsed(${brandId}, ${format}): ${error.message}`);
  }

  const seen: string[] = [];
  for (const row of data ?? []) {
    const pid = row.parent_asset_id as string;
    if (!seen.includes(pid)) seen.push(pid);
    if (seen.length >= limit) break;
  }
  return seen;
}

/**
 * Returns up to `limit` distinct segment_ids most-recently used (any format)
 * for this brand, ordered most-recent-first.
 *
 * Format-agnostic by design: both routine and meme should avoid segments
 * that were just shown. A segment used last in a routine should still be
 * cooldown-excluded when picking a meme.
 */
export async function getRecentSegmentsUsed(
  brandId: string,
  limit = 2,
): Promise<string[]> {
  if (limit < 1) return [];
  const overFetch = Math.max(limit * 8, 16);

  const { data, error } = await supabaseAdmin
    .from('simple_pipeline_render_history')
    .select('segment_id, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(overFetch);

  if (error) {
    throw new Error(`getRecentSegmentsUsed(${brandId}): ${error.message}`);
  }

  const seen: string[] = [];
  for (const row of data ?? []) {
    const sid = row.segment_id as string;
    if (!seen.includes(sid)) seen.push(sid);
    if (seen.length >= limit) break;
  }
  return seen;
}

/**
 * Inserts one row per picked segment. All rows share the same parent_asset_id,
 * format, and job_id. Single-statement multi-row insert.
 */
export async function logRender(input: LogRenderInput): Promise<void> {
  if (input.segmentIds.length === 0) {
    throw new Error('logRender: segmentIds must not be empty');
  }
  const rows = input.segmentIds.map((segmentId) => ({
    brand_id: input.brandId,
    parent_asset_id: input.parentAssetId,
    segment_id: segmentId,
    job_id: input.jobId,
    format: input.format,
  }));

  const { error } = await supabaseAdmin
    .from('simple_pipeline_render_history')
    .insert(rows);

  if (error) {
    throw new Error(`logRender(${input.brandId}, ${input.format}): ${error.message}`);
  }
}
