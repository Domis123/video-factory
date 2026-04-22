/**
 * W3 library inventory — structured snapshot of what's currently on the shelf
 * for a brand, served to the Planner (W3) so it designs videos the library can
 * actually support.
 *
 * Sibling to the Phase 3.5 `library-inventory.ts` which emits a narrower,
 * body-region-focused shape for the library-aware CD. The two coexist; the
 * Planner consumes this v2 shape, the Phase 3.5 CD keeps its own.
 *
 * Aggregation runs in TypeScript (per W3 Decision 6) — fetches the brand's
 * asset_segments rows and reduces in-process. At current library scale
 * (~900 rows heading to ~1500) the single fetch is acceptable; promote to
 * an RPC at W4 only if bench warrants.
 *
 * File: src/agents/library-inventory-v2.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import { normalizeToken } from '../lib/text-normalize.js';
import type {
  LibraryInventory,
  LibraryInventoryBRollMix,
} from '../types/library-inventory.js';

const SEGMENT_TYPE_KEYS = [
  'setup',
  'exercise',
  'transition',
  'hold',
  'cooldown',
  'talking-head',
  'b-roll',
  'unusable',
] as const;

const LONG_HOLD_MIN_DURATION_S = 10;
const TOP_N_EQUIPMENT = 30;
const TOP_N_EXERCISES = 30;
const MIN_EXERCISE_COUNT = 2;
// PostgREST silently caps `.select()` result sets at 1000 rows regardless of
// .limit() or .range() requests (server-side max-rows). At nordpilates scale
// (1116+ segments) a single fetch under-counts by ~10%. Page explicitly.
const SEGMENT_PAGE_SIZE = 1000;
const SEGMENT_PAGE_SAFETY_CAP = 50; // 50k rows — hard bail if pagination runs away

interface SegmentV2Setting {
  location?: string;
  equipment_visible?: string[];
}

interface SegmentV2Exercise {
  name?: string | null;
  body_regions?: string[];
  confidence?: string;
}

interface SegmentV2Shape {
  setting?: SegmentV2Setting;
  exercise?: SegmentV2Exercise;
}

interface SegmentRow {
  start_s: number | null;
  end_s: number | null;
  segment_type: string | null;
  keyframe_grid_r2_key: string | null;
  segment_v2: SegmentV2Shape | null;
}

export async function getLibraryInventory(brandId: string): Promise<LibraryInventory> {
  // 1. Parent-asset count — separate table, simple count.
  const { count: parentCount, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);
  if (parentErr) {
    throw new Error(`library-inventory-v2 parents count failed: ${parentErr.message}`);
  }

  // 2. Paginated fetch over this brand's asset_segments, computing everything
  // we need in one pass post-fetch. `.order('id')` guarantees stable pagination
  // (LIMIT/OFFSET on an unordered query is non-deterministic per PG semantics).
  const rows: SegmentRow[] = [];
  let from = 0;
  let pages = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('asset_segments')
      .select('start_s, end_s, segment_type, keyframe_grid_r2_key, segment_v2')
      .eq('brand_id', brandId)
      .order('id', { ascending: true })
      .range(from, from + SEGMENT_PAGE_SIZE - 1);
    if (error) {
      throw new Error(
        `library-inventory-v2 segments fetch failed at page ${pages} (from=${from}): ${error.message}`,
      );
    }
    const page = (data ?? []) as SegmentRow[];
    rows.push(...page);
    pages++;
    if (page.length < SEGMENT_PAGE_SIZE) break;
    from += SEGMENT_PAGE_SIZE;
    if (pages > SEGMENT_PAGE_SAFETY_CAP) {
      throw new Error(
        `library-inventory-v2 segments fetch exceeded ${SEGMENT_PAGE_SAFETY_CAP} pages; likely pagination runaway`,
      );
    }
  }

  const segmentTypeCounts: Record<string, number> = {};
  for (const key of SEGMENT_TYPE_KEYS) segmentTypeCounts[key] = 0;

  const bodyRegionCounts: Record<string, number> = {};
  const rawEquipment: string[] = [];
  const rawExerciseNames: string[] = [];

  const bRollMix: LibraryInventoryBRollMix = {
    lifestyle_likely: 0,
    exercise_adjacent_likely: 0,
    ambiguous: 0,
  };

  let v2Segments = 0;
  let griddedSegments = 0;
  let longHoldCount = 0;

  for (const row of rows) {
    if (row.segment_type) {
      segmentTypeCounts[row.segment_type] =
        (segmentTypeCounts[row.segment_type] ?? 0) + 1;
    }

    if (row.keyframe_grid_r2_key) griddedSegments++;

    const v2 = row.segment_v2;
    if (!v2) continue;
    v2Segments++;

    const body = v2.exercise?.body_regions;
    if (Array.isArray(body)) {
      for (const region of body) {
        if (typeof region === 'string' && region.length > 0) {
          bodyRegionCounts[region] = (bodyRegionCounts[region] ?? 0) + 1;
        }
      }
    }

    const equipmentList = v2.setting?.equipment_visible;
    if (Array.isArray(equipmentList)) {
      for (const item of equipmentList) {
        if (typeof item === 'string' && item.length > 0) {
          rawEquipment.push(item);
        }
      }
    }

    const confidence = v2.exercise?.confidence;
    const exerciseName = v2.exercise?.name;
    if (
      typeof exerciseName === 'string' &&
      exerciseName.length > 0 &&
      (confidence === 'high' || confidence === 'medium')
    ) {
      rawExerciseNames.push(exerciseName);
    }

    if (row.segment_type === 'b-roll') {
      const location = v2.setting?.location;
      const equipCount = Array.isArray(equipmentList) ? equipmentList.length : 0;
      if (
        (location === 'home' || location === 'outdoor' || location === 'other') &&
        equipCount === 0
      ) {
        bRollMix.lifestyle_likely++;
      } else if (location === 'studio' || location === 'gym' || equipCount > 0) {
        bRollMix.exercise_adjacent_likely++;
      } else {
        bRollMix.ambiguous++;
      }
    }

    // Long-hold counts clip span (end_s - start_s), not recommended_duration_s.
    // The latter is Gemini's trimmed "useful window" estimate and caps well
    // below 10s on nordpilates (exercise ≤8s, hold ≤6s), so it would zero out
    // this signal. The Director cares about whether a sustained shot exists
    // on the shelf — clip span is the right measure.
    if (
      (row.segment_type === 'hold' || row.segment_type === 'exercise') &&
      typeof row.start_s === 'number' &&
      typeof row.end_s === 'number' &&
      row.end_s - row.start_s >= LONG_HOLD_MIN_DURATION_S
    ) {
      longHoldCount++;
    }
  }

  const bodyRegions = Object.entries(bodyRegionCounts)
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));

  const equipmentNormalizedCounts: Record<string, number> = {};
  for (const raw of rawEquipment) {
    const key = normalizeToken(raw);
    if (!key) continue;
    equipmentNormalizedCounts[key] = (equipmentNormalizedCounts[key] ?? 0) + 1;
  }
  const equipment = Object.entries(equipmentNormalizedCounts)
    .map(([eq, count]) => ({ equipment: eq, count }))
    .sort((a, b) => b.count - a.count || a.equipment.localeCompare(b.equipment))
    .slice(0, TOP_N_EQUIPMENT);

  const exerciseNormalizedCounts: Record<string, number> = {};
  for (const raw of rawExerciseNames) {
    const key = normalizeToken(raw);
    if (!key) continue;
    exerciseNormalizedCounts[key] = (exerciseNormalizedCounts[key] ?? 0) + 1;
  }
  const top_exercises = Object.entries(exerciseNormalizedCounts)
    .filter(([, count]) => count >= MIN_EXERCISE_COUNT)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_N_EXERCISES);

  return {
    brand_id: brandId,
    generated_at: new Date().toISOString(),
    totals: {
      parents: parentCount ?? 0,
      segments: rows.length,
      v2_segments: v2Segments,
      gridded_segments: griddedSegments,
    },
    segment_type_counts: segmentTypeCounts,
    body_regions: bodyRegions,
    equipment,
    top_exercises,
    b_roll_mix: bRollMix,
    long_hold_count: longHoldCount,
    talking_head_count: segmentTypeCounts['talking-head'] ?? 0,
  };
}
