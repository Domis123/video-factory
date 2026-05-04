/**
 * Editor agent — schema + clamp logic.
 *
 * v1.3 introduces a single-call BATCH architecture (per brief §5a):
 * one Gemini call with all N segments as input returns one
 * EditorBatchOutput with N refinements + global_reasoning.
 *
 * This file currently exports BOTH:
 *   - the v1.2.x per-segment schema (`editorRefinementSchema`,
 *     `applyClamps`, etc.) — still imported by editor-agent.ts at
 *     this commit (c2); will be removed when c3 rewrites
 *     editor-agent.ts to use the batch shape.
 *   - the v1.3 batch schema (`editorBatchOutputSchema`,
 *     `applyBatchClamps`, etc.) — added in c2 alongside the v1.2.x
 *     exports so the build stays clean before c3 swaps the consumer.
 *
 * Drop authority is new in v1.3: model can return action='drop' on any
 * segment. Drop GUARDS (under-band floor projection, slot count
 * minimum) are enforced ORCHESTRATOR-SIDE — they require cross-segment
 * context this module doesn't see. `applyBatchClamps` only validates
 * shape and per-segment refined-bound clamps; the orchestrator decides
 * which drops are accepted.
 *
 * Zod validates the JSON shape Gemini emits. Clamps + completeness
 * checks run AFTER Zod (Rule 39: don't encode soft policy as schema
 * invariants).
 *
 * File: src/agents/editor-agent-schema.ts
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// v1.2.x per-segment schema (RETAINED until c3 swaps editor-agent.ts)
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// v1.3 batch schema (NEW)
// ═══════════════════════════════════════════════════════════════════════════

/** Action the model takes on a single segment within a batch. */
export const editorActionEnum = z.enum(['refine', 'no_change', 'drop']);
export type EditorAction = z.infer<typeof editorActionEnum>;

/**
 * One segment's entry within a batch refinement.
 *
 * superRefine enforces conditional required-ness:
 *   - action='refine' → refined_start_s + refined_end_s required
 *   - action='no_change' or 'drop' → refined_*_s ignored (may be present
 *     or absent; the model is told to omit them but we don't reject)
 */
export const editorBatchRefinementSchema = z
  .object({
    segment_id: z.string().uuid(),
    action: editorActionEnum,
    refined_start_s: z.number().optional(),
    refined_end_s: z.number().optional(),
    reasoning: z.string().min(1),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'refine') {
      if (v.refined_start_s === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['refined_start_s'],
          message: 'refined_start_s required when action=refine',
        });
      }
      if (v.refined_end_s === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['refined_end_s'],
          message: 'refined_end_s required when action=refine',
        });
      }
    }
  });

export type EditorBatchRefinement = z.infer<typeof editorBatchRefinementSchema>;

/** Top-level wrapper returned by the single Gemini batch call. */
export const editorBatchOutputSchema = z.object({
  refinements: z.array(editorBatchRefinementSchema).min(1),
  global_reasoning: z.string().min(1),
});

export type EditorBatchOutput = z.infer<typeof editorBatchOutputSchema>;

export function validateEditorBatchOutput(raw: unknown): EditorBatchOutput {
  return editorBatchOutputSchema.parse(raw);
}

// ─── Batch completeness check (post-Zod) ──────────────────────────────────
//
// Every input segment_id must be present exactly once in
// output.refinements. No duplicates, no extras, no missing. Caller uses
// this to decide whether to fall the entire batch back to original
// boundaries (per brief Q3 — fallback is all-or-nothing, never partial).

export type BatchCompletenessIssue =
  | { kind: 'missing'; segmentId: string }
  | { kind: 'extra'; segmentId: string }
  | { kind: 'duplicate'; segmentId: string };

export type BatchCompletenessResult =
  | { ok: true }
  | { ok: false; issues: BatchCompletenessIssue[] };

export function validateBatchCompleteness(
  output: EditorBatchOutput,
  expectedSegmentIds: string[],
): BatchCompletenessResult {
  const expected = new Set(expectedSegmentIds);
  const issues: BatchCompletenessIssue[] = [];
  const seen = new Map<string, number>();

  for (const r of output.refinements) {
    seen.set(r.segment_id, (seen.get(r.segment_id) ?? 0) + 1);
    if (!expected.has(r.segment_id)) {
      issues.push({ kind: 'extra', segmentId: r.segment_id });
    }
  }
  for (const [segmentId, count] of seen) {
    if (count > 1) {
      issues.push({ kind: 'duplicate', segmentId });
    }
  }
  for (const segmentId of expectedSegmentIds) {
    if (!seen.has(segmentId)) {
      issues.push({ kind: 'missing', segmentId });
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ═══════════════════════════════════════════════════════════════════════════
// Render context fields (carried from v1.2.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// In v1.2.x these were per-call fields. In v1.3 they remain the same
// shape but live in the batch input's render_context block. Same Zod
// validation; semantics shift in the caller.

export const renderContextFieldsSchema = z.object({
  slotCountTotal: z.number().int().min(1).max(10),
  currentRenderDurationS: z.number().min(0),
  targetRenderDurationS: z.number().min(1),
});

export type RenderContextFields = z.infer<typeof renderContextFieldsSchema>;

export function validateRenderContextFields(raw: unknown): RenderContextFields {
  return renderContextFieldsSchema.parse(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// Clamp logic — shared constants and types
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_REFINED_DURATION_S = 1.5;

export interface OriginalBounds {
  startS: number;
  endS: number;
}

// ─── v1.2.x per-segment ClampOutcome + applyClamps (RETAINED) ─────────────

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

// ─── v1.3 batch ClampOutcome + applyBatchClamps (NEW) ─────────────────────
//
// Differences from v1.2.x:
//   - 'no_change' (renamed from 'no_change_needed') matches new action enum
//   - 'drop' is a new outcome variant (no refined bounds, just reasoning)
//   - 'fallback' adds 'missing_refined_bounds' reason for action=refine
//     entries that bypassed the schema's superRefine somehow
//
// Floor / slot-min guards for drops are NOT in this function. Orchestrator
// runs those checks because they need cross-segment projection.

export type BatchClampOutcome =
  | {
      kind: 'refined_ok';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ('clamp:start_widened' | 'clamp:end_widened')[];
    }
  | {
      kind: 'no_change';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ['outcome:no_change'];
    }
  | {
      kind: 'drop';
      reasoning: string;
      clamps: ['outcome:drop'];
    }
  | {
      kind: 'fallback';
      reason: 'duration_floor_violated' | 'invalid_range' | 'missing_refined_bounds';
      refinedStartS: number;
      refinedEndS: number;
      clamps: ('clamp:start_widened' | 'clamp:end_widened')[];
    };

export function applyBatchClamps(
  refinement: EditorBatchRefinement,
  original: OriginalBounds,
): BatchClampOutcome {
  if (refinement.action === 'no_change') {
    return {
      kind: 'no_change',
      refinedStartS: original.startS,
      refinedEndS: original.endS,
      clamps: ['outcome:no_change'],
    };
  }

  if (refinement.action === 'drop') {
    return {
      kind: 'drop',
      reasoning: refinement.reasoning,
      clamps: ['outcome:drop'],
    };
  }

  // action === 'refine'. Schema superRefine should have guaranteed both
  // refined_*_s are numbers, but TS doesn't narrow through the discriminator.
  if (
    refinement.refined_start_s === undefined ||
    refinement.refined_end_s === undefined
  ) {
    return {
      kind: 'fallback',
      reason: 'missing_refined_bounds',
      refinedStartS: original.startS,
      refinedEndS: original.endS,
      clamps: [],
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
