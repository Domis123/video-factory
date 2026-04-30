/**
 * Editor agent — schema + clamp logic for per-segment boundary refinement.
 *
 * Zod validates the JSON shape Gemini emits. Clamps are applied AFTER Zod
 * (Rule 39: don't encode soft policy as schema invariants — Zod sees raw
 * model output, clamps see model output paired with the original bounds
 * the caller knows). Clamp outcomes get logged structurally so c4's
 * job_events.payload.editor_outcome can aggregate.
 *
 * File: src/agents/editor-agent-schema.ts
 */

import { z } from 'zod';

// ─── Zod schema (raw model output) ─────────────────────────────────────────

export const editorRefinementSchema = z.object({
  segment_id: z.string().uuid(),
  refined_start_s: z.number(),
  refined_end_s: z.number(),
  reasoning: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  no_change_needed: z.boolean(),
});

export type EditorRefinement = z.infer<typeof editorRefinementSchema>;

export function validateEditorRefinement(raw: unknown): EditorRefinement {
  return editorRefinementSchema.parse(raw);
}

// ─── Clamp logic (post-Zod, pre-render) ────────────────────────────────────

export const MIN_REFINED_DURATION_S = 1.5;

/**
 * Outcome of applying clamps to a Zod-validated refinement.
 *
 * - 'refined_ok'        — refinement accepted (possibly with start/end clamped
 *                          to original bounds; clamps array names which fired).
 * - 'no_change_needed'  — model returned no_change_needed=true; use original
 *                          bounds. refined_* fields are ignored.
 * - 'fallback'          — refinement rejected (duration floor or invalid range);
 *                          caller falls back to original bounds.
 *
 * `clamps` lists structural events that fired during evaluation. Always
 * present (empty array when nothing fired) so consumers can aggregate
 * uniformly.
 */
export type ClampOutcome =
  | {
      kind: 'refined_ok';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ('clamp:start_widened' | 'clamp:end_widened')[];
    }
  | {
      kind: 'no_change_needed';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ['outcome:no_change_needed'];
    }
  | {
      kind: 'fallback';
      reason: 'duration_floor_violated' | 'invalid_range';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ('clamp:start_widened' | 'clamp:end_widened')[];
    };

export interface OriginalBounds {
  startS: number;
  endS: number;
}

/**
 * Apply the brief's hard clamps in order. Returns a tagged ClampOutcome.
 *
 * Order matters:
 *   0. no_change_needed=true short-circuits before any clamp evaluation.
 *   1. start_widened — clamp refined_start_s up to original_start_s.
 *   2. end_widened   — clamp refined_end_s down to original_end_s.
 *   3. invalid_range — refined_start_s >= refined_end_s after clamping → fallback.
 *   4. duration_floor — refined duration < 1.5s after clamping → fallback.
 */
export function applyClamps(
  refinement: EditorRefinement,
  original: OriginalBounds,
): ClampOutcome {
  if (refinement.no_change_needed) {
    return {
      kind: 'no_change_needed',
      refinedStartS: original.startS,
      refinedEndS: original.endS,
      clamps: ['outcome:no_change_needed'],
    };
  }

  const clamps: ('clamp:start_widened' | 'clamp:end_widened')[] = [];

  let start = refinement.refined_start_s;
  let end = refinement.refined_end_s;

  if (start < original.startS) {
    start = original.startS;
    clamps.push('clamp:start_widened');
  }
  if (end > original.endS) {
    end = original.endS;
    clamps.push('clamp:end_widened');
  }

  if (start >= end) {
    return {
      kind: 'fallback',
      reason: 'invalid_range',
      refinedStartS: original.startS,
      refinedEndS: original.endS,
      clamps,
    };
  }

  if (end - start < MIN_REFINED_DURATION_S) {
    return {
      kind: 'fallback',
      reason: 'duration_floor_violated',
      refinedStartS: original.startS,
      refinedEndS: original.endS,
      clamps,
    };
  }

  return {
    kind: 'refined_ok',
    refinedStartS: start,
    refinedEndS: end,
    clamps,
  };
}
