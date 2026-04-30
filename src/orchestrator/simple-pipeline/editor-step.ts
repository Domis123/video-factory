/**
 * Editor step for the Simple Pipeline orchestrator.
 *
 * Sits between Match-Or-Match and the render step. Takes the picked
 * segment_ids, fetches each segment's editor-relevant metadata, calls
 * refineSegmentBoundary in parallel via Promise.all, and emits:
 *
 *   - refinedBoundsBySegmentId  : segment_id → { startS, endS, refined }
 *   - outcome                    : observability payload for
 *                                   job_events.payload.editor_outcome
 *
 * Format gating per brief Q4: routine path invokes the editor; meme path
 * bypasses entirely (editor_invoked=false). Per-segment isolation per
 * brief Q7: a fallback on segment 2 does NOT affect segments 1, 3, 4, 5.
 *
 * File: src/orchestrator/simple-pipeline/editor-step.ts
 */

import { supabaseAdmin } from '../../config/supabase.js';
import {
  refineSegmentBoundary,
  type EditorAgentInput,
  type EditorAgentOutcome,
  type SlotRole,
} from '../../agents/editor-agent.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface RefinedBounds {
  /** Refined start time. Equal to original when refined=false. */
  startS: number;
  /** Refined end time. Equal to original when refined=false. */
  endS: number;
  /** True when bounds came from a refined_ok outcome (not fallback / no_change). */
  refined: boolean;
}

export interface EditorOutcomePayload {
  /** false on meme path or when there are no segments to refine. */
  editor_invoked: boolean;
  segments_total: number;
  /** Refinements that produced bounds different from the original. */
  segments_refined: number;
  /** Outcomes where the model returned no_change_needed=true. */
  segments_no_change: number;
  /** Outcomes that fell back to original bounds (any reason). */
  segments_fallback: number;
  /** Counts keyed by fallback reason; empty object when 0 fallbacks. */
  fallback_reasons: Record<string, number>;
  /** Total wall ms of the parallel Promise.all. */
  editor_wall_ms: number;
  /** Sum of per-call cost from Gemini billing. */
  editor_cost_usd: number;
}

export interface EditorStepResult {
  refinedBoundsBySegmentId: Map<string, RefinedBounds>;
  outcome: EditorOutcomePayload;
}

export interface EditorStepInput {
  jobId: string;
  segmentIds: string[];
  ideaSeed: string;
  format: 'routine' | 'meme';
}

// ─── Public entry ─────────────────────────────────────────────────────────

export async function runEditorStep(input: EditorStepInput): Promise<EditorStepResult> {
  const t0 = Date.now();

  // Meme bypass per brief Q4 — never invoke the editor.
  if (input.format === 'meme') {
    return memeBypass(input.segmentIds, t0);
  }

  if (input.segmentIds.length === 0) {
    return memeBypass([], t0);
  }

  const rows = await fetchSegmentsForEditor(input.segmentIds);

  // Build inputs in segment_id order, assigning slot roles by position.
  const inputs: EditorAgentInput[] = input.segmentIds.map((id, idx) => {
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
      editorUse: null,
      segmentV2: row.segmentV2,
      keyframeGridR2Key: row.keyframeGridR2Key,
      ideaSeed: input.ideaSeed,
      slotRole: pickSlotRole(idx, input.segmentIds.length),
    };
  });

  console.log(
    `[editor-step] jobId=${input.jobId} invoking editor on ${inputs.length} segment(s) in parallel`,
  );

  // Promise.all enforces per-segment isolation: each refineSegmentBoundary
  // call returns a tagged outcome rather than throwing, so one segment's
  // fallback never causes a sibling to abort.
  const outcomes = await Promise.all(inputs.map((i) => refineSegmentBoundary(i)));

  const refinedBoundsBySegmentId = new Map<string, RefinedBounds>();
  let segmentsRefined = 0;
  let segmentsNoChange = 0;
  let segmentsFallback = 0;
  const fallbackReasons: Record<string, number> = {};
  let totalCost = 0;

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const inp = inputs[i];
    totalCost += o.costUsd;

    if (o.kind === 'refined_ok') {
      segmentsRefined++;
      refinedBoundsBySegmentId.set(inp.segmentId, {
        startS: o.refinedStartS,
        endS: o.refinedEndS,
        refined: true,
      });
    } else if (o.kind === 'no_change_needed') {
      segmentsNoChange++;
      refinedBoundsBySegmentId.set(inp.segmentId, {
        startS: inp.originalStartS,
        endS: inp.originalEndS,
        refined: false,
      });
    } else {
      // fallback
      segmentsFallback++;
      fallbackReasons[o.reason] = (fallbackReasons[o.reason] || 0) + 1;
      refinedBoundsBySegmentId.set(inp.segmentId, {
        startS: inp.originalStartS,
        endS: inp.originalEndS,
        refined: false,
      });
    }
  }

  const wallMs = Date.now() - t0;
  console.log(
    `[editor-step] jobId=${input.jobId} done: ` +
      `refined=${segmentsRefined} no_change=${segmentsNoChange} fallback=${segmentsFallback} ` +
      `wall=${wallMs}ms cost=$${totalCost.toFixed(4)}`,
  );

  return {
    refinedBoundsBySegmentId,
    outcome: {
      editor_invoked: true,
      segments_total: outcomes.length,
      segments_refined: segmentsRefined,
      segments_no_change: segmentsNoChange,
      segments_fallback: segmentsFallback,
      fallback_reasons: fallbackReasons,
      editor_wall_ms: wallMs,
      editor_cost_usd: Number(totalCost.toFixed(6)),
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

function pickSlotRole(idx: number, total: number): SlotRole {
  if (idx === 0) return 'hook';
  if (idx === total - 1) return 'close';
  return 'body';
}

function memeBypass(segmentIds: string[], t0: number): EditorStepResult {
  return {
    refinedBoundsBySegmentId: new Map(),
    outcome: {
      editor_invoked: false,
      segments_total: segmentIds.length,
      segments_refined: 0,
      segments_no_change: 0,
      segments_fallback: 0,
      fallback_reasons: {},
      editor_wall_ms: Date.now() - t0,
      editor_cost_usd: 0,
    },
  };
}

// Re-export EditorAgentOutcome for tests/consumers that want the underlying type.
export type { EditorAgentOutcome };
