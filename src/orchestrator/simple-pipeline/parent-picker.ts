/**
 * Parent picker — eligibility + LRU fallback for the routine path.
 *
 * Computes the set of `excludedParents` to feed Match-Or-Match's routine
 * call. The agent picks within the eligible set; this module decides what
 * the eligible set should look like given cooldown state.
 *
 * The routine path's eligible-parent universe is parents with ≥10
 * v2-analyzed segments (Q9). If the brand has ≥3 eligible parents, we
 * apply the standard last-2-used cooldown. If only 2 eligible parents
 * exist, we relax cooldown to last-1 (LRU) so the system can still
 * produce videos. If only 1 eligible parent exists, no cooldown is
 * applied (no choice to make).
 *
 * If 0 eligible parents exist, the caller (orchestrator + S1 readiness
 * endpoint) should have blocked the job before reaching here. We throw
 * loudly rather than silently emit empty exclusion lists, because the
 * downstream Match-Or-Match call would fail in a more confusing way.
 *
 * File: src/orchestrator/simple-pipeline/parent-picker.ts
 */

import { supabaseAdmin } from '../../config/supabase.js';
import { getRecentParentsUsed } from './segment-cooldown-tracker.js';

const PARENT_MIN_V2_SEGMENTS = 10; // Q9 floor

export interface RoutineExclusionPlan {
  excludedParents: string[];
  totalEligibleParents: number;
  fallbackTriggered: boolean;
  /**
   * Reason string for logs — describes which branch of the eligibility
   * tree was taken. Useful for c10 Gate A and post-deploy debugging.
   */
  reason: string;
}

/**
 * Returns a count of distinct parent_asset_ids for the brand that have
 * ≥10 v2-analyzed asset_segments (Q9 floor).
 *
 * Pulled into its own helper because the orchestrator's S1 readiness
 * endpoint (c7) reuses the same query shape.
 */
export async function countEligibleRoutineParents(brandId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('parent_asset_id')
    .eq('brand_id', brandId)
    .not('segment_v2', 'is', null);

  if (error) {
    throw new Error(`countEligibleRoutineParents(${brandId}): ${error.message}`);
  }

  const parentCounts = new Map<string, number>();
  for (const row of data ?? []) {
    const pid = row.parent_asset_id as string;
    if (!pid) continue;
    parentCounts.set(pid, (parentCounts.get(pid) ?? 0) + 1);
  }

  let eligible = 0;
  for (const c of parentCounts.values()) {
    if (c >= PARENT_MIN_V2_SEGMENTS) eligible++;
  }
  return eligible;
}

/**
 * Builds the routine-path exclusion plan: how many parents to exclude
 * from cooldown given the brand's eligibility, and what those parents are.
 *
 * Branches:
 *   - 0 eligible: throw (caller is responsible for readiness)
 *   - 1 eligible: empty exclusion (no choice)
 *   - 2 eligible: relax to last-1 used (LRU fallback, fallbackTriggered=true)
 *   - ≥3 eligible: standard last-2 used cooldown
 */
export async function planRoutineExclusions(brandId: string): Promise<RoutineExclusionPlan> {
  const totalEligible = await countEligibleRoutineParents(brandId);

  if (totalEligible === 0) {
    throw new Error(
      `planRoutineExclusions(${brandId}): brand has 0 eligible parents (≥${PARENT_MIN_V2_SEGMENTS} v2-analyzed segments). ` +
        `Readiness endpoint should have blocked this job before agent invocation.`,
    );
  }

  if (totalEligible === 1) {
    return {
      excludedParents: [],
      totalEligibleParents: 1,
      fallbackTriggered: false,
      reason: 'single eligible parent; cooldown N/A',
    };
  }

  if (totalEligible === 2) {
    const recent = await getRecentParentsUsed(brandId, 'routine', 1);
    return {
      excludedParents: recent,
      totalEligibleParents: 2,
      fallbackTriggered: true,
      reason: `LRU fallback: only 2 eligible parents, excluded last 1 used (${recent[0] ?? 'none yet'})`,
    };
  }

  // ≥3 eligible: standard last-2 cooldown
  const recent = await getRecentParentsUsed(brandId, 'routine', 2);
  return {
    excludedParents: recent,
    totalEligibleParents: totalEligible,
    fallbackTriggered: false,
    reason: `standard cooldown: ${totalEligible} eligible parents, excluded last 2 used`,
  };
}
