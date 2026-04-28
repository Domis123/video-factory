/**
 * Simple Pipeline readiness check — per kickoff Q4.
 *
 * Returns a discriminated result indicating whether brand X is ready to
 * accept Simple Pipeline jobs. n8n S1 calls the HTTP wrapper of this
 * before inserting jobs.status='simple_pipeline_pending'; if the brand
 * isn't ready, S1 inserts with status='simple_pipeline_blocked' and the
 * returned reason token.
 *
 * Reason tokens (Q4-enumerated, stable string identifiers — n8n S1
 * persists them as the failure reason):
 *   - 'missing_aesthetic_description'
 *   - 'insufficient_parents_<N>_of_3_needed'   (N = actual count)
 *   - 'insufficient_music_tracks_<N>_of_5_needed' (N = actual count)
 *
 * Order of checks matters for operator triage: brand-config first
 * (cheapest fix is to populate one column), then content (operator
 * needs to ingest more), then music (operator needs to seed more).
 *
 * File: src/orchestrator/simple-pipeline/readiness.ts
 */

import { supabaseAdmin } from '../../config/supabase.js';
import { countEligibleRoutineParents } from './parent-picker.js';

export type ReadinessResult =
  | { ok: true }
  | { ok: false; reason: string };

const MIN_PARENTS = 3;
const MIN_MUSIC_TRACKS = 5;

export async function checkSimplePipelineReadiness(
  brandId: string,
): Promise<ReadinessResult> {
  // 1. Brand-side: aesthetic_description present
  const { data: brand, error: brandErr } = await supabaseAdmin
    .from('brand_configs')
    .select('aesthetic_description')
    .eq('brand_id', brandId)
    .single();

  if (brandErr || !brand) {
    // brand_configs row missing entirely is the same operator-side
    // problem as missing aesthetic_description: the brand isn't
    // configured. Reuse the same reason token to keep S1 logic simple.
    return { ok: false, reason: 'missing_aesthetic_description' };
  }
  if (!brand.aesthetic_description) {
    return { ok: false, reason: 'missing_aesthetic_description' };
  }

  // 2. Content-side: ≥3 parents with ≥10 v2-analyzed segments (Q9)
  const eligibleParents = await countEligibleRoutineParents(brandId);
  if (eligibleParents < MIN_PARENTS) {
    return {
      ok: false,
      reason: `insufficient_parents_${eligibleParents}_of_${MIN_PARENTS}_needed`,
    };
  }

  // 3. Music-side: ≥5 music_tracks (no `active` filter — column doesn't
  //    exist; per Q10 all rows are treated as live)
  const { count: musicCount, error: musicErr } = await supabaseAdmin
    .from('music_tracks')
    .select('id', { count: 'exact', head: true });
  if (musicErr) {
    // Treat query failure as "fail open" would mask bad state. Treat as
    // not-ready with a diagnostic reason.
    return { ok: false, reason: `music_query_failed_${musicErr.message.slice(0, 30)}` };
  }
  const tracks = musicCount ?? 0;
  if (tracks < MIN_MUSIC_TRACKS) {
    return {
      ok: false,
      reason: `insufficient_music_tracks_${tracks}_of_${MIN_MUSIC_TRACKS}_needed`,
    };
  }

  return { ok: true };
}
