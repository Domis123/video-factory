/**
 * Editor step for the Simple Pipeline orchestrator (v1.3 batch).
 *
 * Sits between Match-Or-Match and the render step. Takes the picked
 * segment_ids, fetches each segment's editor-relevant metadata, calls
 * `refineSegmentBatch` (single Gemini multimodal call with N keyframe
 * grids), and emits:
 *
 *   - refinedBoundsBySegmentId  : segment_id → { startS, endS, refined }
 *                                  Includes ALL input segments. Dropped
 *                                  segments retain their original bounds
 *                                  here; orchestrator filters them out
 *                                  of the render input separately based
 *                                  on `proposedDrops`.
 *   - proposedDrops              : segment_ids the model wants to drop +
 *                                  reasoning + confidence. Orchestrator
 *                                  applies floor / slot-min guards and
 *                                  decides which to honor.
 *   - outcome                    : observability payload for
 *                                  job_events.payload.editor_outcome.
 *                                  Orchestrator augments with drops_rejected
 *                                  count after applying guards.
 *
 * Format gating per brief Q4 (carried from v1.2.x): routine path invokes
 * the editor; meme path bypasses entirely (editor_invoked=false).
 *
 * Failure model per brief Q3: all-or-nothing batch fallback. If the
 * single Gemini call fails (transient, Zod parse, completeness mismatch),
 * the entire batch falls back — every segment kind=fallback with
 * original bounds, no drops proposed. Per-segment fallback (e.g.
 * action=refine that fails the duration floor on one segment while
 * siblings succeed) is still possible inside a successful batch.
 *
 * File: src/orchestrator/simple-pipeline/editor-step.ts
 */

import { supabaseAdmin } from '../../config/supabase.js';
import {
  refineSegmentBatch,
  type EditorBatchAgentInput,
  type EditorBatchAgentOutcome,
  type EditorBatchSegmentInput,
} from '../../agents/editor-agent.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface RefinedBounds {
  /** Refined start time. Equal to original when refined=false. */
  startS: number;
  /** Refined end time. Equal to original when refined=false. */
  endS: number;
  /** True when bounds came from a refined action (not no_change / fallback / drop). */
  refined: boolean;
}

export interface ProposedDrop {
  segmentId: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface EditorOutcomePayload {
  /** false on meme path / editorDisabled / empty input. */
  editor_invoked: boolean;
  /** True when entire batch fell back to original boundaries. */
  batch_fallback: boolean;
  /** Reason if batch_fallback=true. Null otherwise. */
  batch_fallback_reason: string | null;
  /** Model's batch-level reasoning. Null when batch fell back. */
  global_reasoning: string | null;
  segments_total: number;
  /** Refinements that produced bounds different from the original. */
  segments_refined: number;
  /** Outcomes where the model returned action=no_change. */
  segments_no_change: number;
  /** Outcomes where the model returned action=drop (count BEFORE orchestrator guards). */
  segments_dropped_proposed: number;
  /** Per-segment fallbacks within a successful batch (clamp violations). */
  segments_fallback: number;
  /** Counts keyed by per-segment fallback reason; empty object when 0 fallbacks. */
  fallback_reasons: Record<string, number>;
  /** Drop reasoning strings for diagnostic; only populated when drops were proposed. */
  drop_reasons: string[];
  /** Total wall ms of the single batch call (includes grid fetch + Gemini + parse). */
  editor_wall_ms: number;
  /** Cost from the single Gemini billing event. */
  editor_cost_usd: number;
}

export interface EditorStepResult {
  refinedBoundsBySegmentId: Map<string, RefinedBounds>;
  proposedDrops: ProposedDrop[];
  outcome: EditorOutcomePayload;
}

export interface EditorStepInput {
  jobId: string;
  segmentIds: string[];
  ideaSeed: string;
  format: 'routine' | 'meme';
  /**
   * Per-job toggle. When true, the routine path skips the Editor just
   * like the meme path (editor_invoked=false, no drops, empty refined
   * map, $0 cost, ~0ms wall). Default false.
   */
  editorDisabled?: boolean;
  /** Soft target render duration. Default 30s. */
  targetRenderDurationS?: number;
}

const DEFAULT_TARGET_RENDER_DURATION_S = 30;

// ─── Public entry ─────────────────────────────────────────────────────────

export async function runEditorStep(input: EditorStepInput): Promise<EditorStepResult> {
  const t0 = Date.now();

  // Meme bypass per brief Q4 — never invoke the editor.
  if (input.format === 'meme') {
    return bypass(input.segmentIds, t0);
  }

  // Per-job disable toggle — same shape as meme bypass on routine.
  if (input.editorDisabled === true) {
    console.log(
      `[editor-step] jobId=${input.jobId} editorDisabled=true; bypassing editor (routine baseline mode)`,
    );
    return bypass(input.segmentIds, t0);
  }

  if (input.segmentIds.length === 0) {
    return bypass([], t0);
  }

  const rows = await fetchSegmentsForEditor(input.segmentIds);

  // Sum of all original durations — render-context "current" value seen by the model.
  let currentRenderDurationS = 0;
  for (const id of input.segmentIds) {
    const row = rows.get(id);
    if (row) currentRenderDurationS += row.endS - row.startS;
  }
  const targetRenderDurationS =
    input.targetRenderDurationS ?? DEFAULT_TARGET_RENDER_DURATION_S;

  // Build batch input: one entry per segment, in pick order.
  const batchSegments: EditorBatchSegmentInput[] = input.segmentIds.map((id) => {
    const row = rows.get(id);
    if (!row) {
      throw new Error(
        `runEditorStep: segment id=${id} not found in asset_segments (job=${input.jobId})`,
      );
    }
    return {
      segmentId: id,
      originalStartS: row.startS,
      originalEndS: row.endS,
      segmentType: row.segmentType,
      description: row.description,
      segmentV2: row.segmentV2,
      keyframeGridR2Key: row.keyframeGridR2Key,
    };
  });

  const batchInput: EditorBatchAgentInput = {
    segments: batchSegments,
    ideaSeed: input.ideaSeed,
    slotCountTotal: batchSegments.length,
    currentRenderDurationS,
    targetRenderDurationS,
  };

  console.log(
    `[editor-step] jobId=${input.jobId} invoking single-call editor batch on ${batchSegments.length} segment(s)`,
  );

  const batch: EditorBatchAgentOutcome = await refineSegmentBatch(batchInput);

  // ─── Project per-segment outcomes into orchestrator-friendly maps ────────

  const refinedBoundsBySegmentId = new Map<string, RefinedBounds>();
  const proposedDrops: ProposedDrop[] = [];
  let segmentsRefined = 0;
  let segmentsNoChange = 0;
  let segmentsDropped = 0;
  let segmentsFallback = 0;
  const fallbackReasons: Record<string, number> = {};
  const dropReasons: string[] = [];

  for (const ps of batch.perSegment) {
    if (ps.kind === 'refined') {
      segmentsRefined++;
      refinedBoundsBySegmentId.set(ps.segmentId, {
        startS: ps.refinedStartS,
        endS: ps.refinedEndS,
        refined: true,
      });
    } else if (ps.kind === 'no_change') {
      segmentsNoChange++;
      refinedBoundsBySegmentId.set(ps.segmentId, {
        startS: ps.refinedStartS,
        endS: ps.refinedEndS,
        refined: false,
      });
    } else if (ps.kind === 'drop') {
      segmentsDropped++;
      proposedDrops.push({
        segmentId: ps.segmentId,
        reasoning: ps.reasoning,
        confidence: ps.confidence,
      });
      dropReasons.push(ps.reasoning);
      // Bounds preserved at original in case orchestrator rejects the drop.
      const orig = batchSegments.find((s) => s.segmentId === ps.segmentId)!;
      refinedBoundsBySegmentId.set(ps.segmentId, {
        startS: orig.originalStartS,
        endS: orig.originalEndS,
        refined: false,
      });
    } else {
      // per-segment fallback
      segmentsFallback++;
      fallbackReasons[ps.perSegmentFallbackReason] =
        (fallbackReasons[ps.perSegmentFallbackReason] || 0) + 1;
      refinedBoundsBySegmentId.set(ps.segmentId, {
        startS: ps.refinedStartS,
        endS: ps.refinedEndS,
        refined: false,
      });
    }
  }

  const wallMs = Date.now() - t0;

  console.log(
    `[editor-step] jobId=${input.jobId} batch done: ` +
      `batch_fallback=${batch.batchFallback}` +
      (batch.batchFallbackReason ? ` (${batch.batchFallbackReason})` : '') +
      ` refined=${segmentsRefined} no_change=${segmentsNoChange} drops_proposed=${segmentsDropped} fallback=${segmentsFallback} ` +
      `wall=${wallMs}ms cost=$${batch.costUsd.toFixed(4)}`,
  );
  if (batch.globalReasoning) {
    console.log(
      `[editor-step] jobId=${input.jobId} global_reasoning: ${batch.globalReasoning.slice(0, 240)}`,
    );
  }

  return {
    refinedBoundsBySegmentId,
    proposedDrops,
    outcome: {
      editor_invoked: true,
      batch_fallback: batch.batchFallback,
      batch_fallback_reason: batch.batchFallbackReason ?? null,
      global_reasoning: batch.globalReasoning,
      segments_total: batch.perSegment.length,
      segments_refined: segmentsRefined,
      segments_no_change: segmentsNoChange,
      segments_dropped_proposed: segmentsDropped,
      segments_fallback: segmentsFallback,
      fallback_reasons: fallbackReasons,
      drop_reasons: dropReasons,
      editor_wall_ms: wallMs,
      editor_cost_usd: Number(batch.costUsd.toFixed(6)),
    },
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

interface EditorRowLite {
  startS: number;
  endS: number;
  segmentType: string;
  description: string | null;
  segmentV2: Record<string, unknown> | null;
  keyframeGridR2Key: string | null;
}

async function fetchSegmentsForEditor(
  segmentIds: string[],
): Promise<Map<string, EditorRowLite>> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, segment_type, start_s, end_s, description, segment_v2, keyframe_grid_r2_key')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`runEditorStep: fetch failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`runEditorStep: no rows for ids=[${segmentIds.join(', ')}]`);
  }

  const m = new Map<string, EditorRowLite>();
  for (const row of data) {
    const r = row as Record<string, unknown>;
    m.set(r['id'] as string, {
      startS: Number(r['start_s']),
      endS: Number(r['end_s']),
      segmentType: (r['segment_type'] as string) ?? 'unknown',
      description: (r['description'] as string | null) ?? null,
      segmentV2: (r['segment_v2'] as Record<string, unknown> | null) ?? null,
      keyframeGridR2Key: (r['keyframe_grid_r2_key'] as string | null) ?? null,
    });
  }
  return m;
}

function bypass(segmentIds: string[], t0: number): EditorStepResult {
  return {
    refinedBoundsBySegmentId: new Map(),
    proposedDrops: [],
    outcome: {
      editor_invoked: false,
      batch_fallback: false,
      batch_fallback_reason: null,
      global_reasoning: null,
      segments_total: segmentIds.length,
      segments_refined: 0,
      segments_no_change: 0,
      segments_dropped_proposed: 0,
      segments_fallback: 0,
      fallback_reasons: {},
      drop_reasons: [],
      editor_wall_ms: Date.now() - t0,
      editor_cost_usd: 0,
    },
  };
}
