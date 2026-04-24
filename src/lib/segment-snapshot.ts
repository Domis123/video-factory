/**
 * Shared segment snapshot extractor for Part B agents that consume
 * `asset_segments.segment_v2` JSONB downstream of the Director pick step.
 *
 * Both W6 Critic and W7 Copywriter need a summarized view of the picked
 * segments' v2 analyzer output (posture, body regions, on-screen text,
 * exercise name/confidence, etc.) WITHOUT each agent reaching into the DB
 * on its own. W8 (orchestrator) builds the snapshot map once per job and
 * passes the same Map to both consumers, saving one Supabase round trip
 * per Part B invocation (and any revise-loop re-invocations share the
 * same map since the picks are stable within a revise cycle).
 *
 * Extracted from `copywriter-v2.ts` (previously `CopywriterSegmentSnapshot`
 * + `fetchCopywriterSnapshots` + `rowToCopywriterSnapshot`) per W8 brief
 * § "W7 refactor: extract buildSegmentSnapshots". No behavior change —
 * the shape, fetch SQL, row mapping, and error modes are bit-identical;
 * only the location and names changed.
 *
 * File: src/lib/segment-snapshot.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { StoryboardPicks } from '../types/slot-pick.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shape consumed by W6 Critic + W7 Copywriter. No field-level divergence.
// ─────────────────────────────────────────────────────────────────────────────

export interface SegmentSnapshot {
  segment_id: string;
  segment_type: string;
  duration_s: number;
  exercise: {
    name: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
  };
  setting: {
    location: string;
    equipment_visible: string[];
    on_screen_text: string | null;
  };
  posture: string;
  body_focus: string[];
  description: string;
}

interface SegmentRowForSnapshot {
  id: string;
  segment_type: string | null;
  start_s: number | null;
  end_s: number | null;
  description: string | null;
  segment_v2: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build snapshots for every picked segment in a storyboard. Convenience
 * wrapper over {@link fetchSegmentSnapshots} that extracts the segment IDs
 * from picks — the normal orchestrator path.
 */
export async function buildSegmentSnapshots(
  picks: StoryboardPicks,
): Promise<Map<string, SegmentSnapshot>> {
  return fetchSegmentSnapshots(picks.picks.map((p) => p.picked_segment_id));
}

/**
 * Low-level fetch — takes arbitrary segment_ids. Kept as a distinct
 * entry point for test harnesses that need to build snapshot maps from
 * hand-picked IDs without constructing a full StoryboardPicks.
 *
 * Throws if any requested ID is not found in `asset_segments`.
 */
export async function fetchSegmentSnapshots(
  segmentIds: string[],
): Promise<Map<string, SegmentSnapshot>> {
  const out = new Map<string, SegmentSnapshot>();
  if (segmentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, segment_type, start_s, end_s, description, segment_v2')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`[segment-snapshot] fetch failed: ${error.message}`);
  }
  for (const row of (data ?? []) as SegmentRowForSnapshot[]) {
    out.set(row.id, rowToSegmentSnapshot(row));
  }
  for (const id of segmentIds) {
    if (!out.has(id)) {
      throw new Error(
        `[segment-snapshot] segment_id ${id} not found in asset_segments`,
      );
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private row → snapshot mapper
// ─────────────────────────────────────────────────────────────────────────────

function rowToSegmentSnapshot(r: SegmentRowForSnapshot): SegmentSnapshot {
  const v2 = (r.segment_v2 ?? {}) as Record<string, unknown>;
  const exercise = (v2['exercise'] ?? {}) as Record<string, unknown>;
  const setting = (v2['setting'] ?? {}) as Record<string, unknown>;
  const audio = (v2['audio'] ?? {}) as Record<string, unknown>;
  const framing = (v2['framing'] ?? {}) as Record<string, unknown>;

  const duration =
    r.start_s != null && r.end_s != null ? Math.max(0, r.end_s - r.start_s) : 0;

  const bodyFocus = Array.isArray(exercise['body_regions'])
    ? (exercise['body_regions'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];

  const equipment = Array.isArray(setting['equipment_visible'])
    ? (setting['equipment_visible'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];

  const rawConfidence = exercise['name_confidence'];
  const confidence =
    rawConfidence === 'high' ||
    rawConfidence === 'medium' ||
    rawConfidence === 'low'
      ? rawConfidence
      : null;

  // on_screen_text lives under segment_v2.audio per W6's reading; some v2
  // variants nested it under setting instead — check both to be robust to the
  // schema-v2 migration. Behavior preserved from copywriter-v2.ts pre-refactor.
  const ostFromAudio =
    typeof audio['on_screen_text'] === 'string'
      ? (audio['on_screen_text'] as string)
      : null;
  const ostFromSetting =
    typeof setting['on_screen_text'] === 'string'
      ? (setting['on_screen_text'] as string)
      : null;

  return {
    segment_id: r.id,
    segment_type: r.segment_type ?? 'unknown',
    duration_s: +duration.toFixed(2),
    exercise: {
      name:
        typeof exercise['name'] === 'string'
          ? (exercise['name'] as string)
          : null,
      confidence,
    },
    setting: {
      location:
        typeof setting['location'] === 'string'
          ? (setting['location'] as string)
          : 'unknown',
      equipment_visible: equipment,
      on_screen_text: ostFromAudio ?? ostFromSetting,
    },
    posture:
      typeof framing['posture'] === 'string'
        ? (framing['posture'] as string)
        : 'unknown',
    body_focus: bodyFocus,
    description: r.description ?? '',
  };
}
