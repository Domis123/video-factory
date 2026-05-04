/**
 * Editor agent — per-segment boundary refinement.
 *
 * Single Gemini Pro multimodal call per segment, image-only input
 * (keyframe grid + structured text). Returns a tagged outcome:
 *   - refined_ok        — model proposed new bounds within original;
 *                          clamps may have fired but result is usable
 *   - no_change_needed  — model returned no_change_needed=true; original
 *                          bounds preserved
 *   - fallback          — error/clamp violation; original bounds preserved
 *
 * Per-segment isolation per brief: this function NEVER throws to the
 * caller. Every failure path returns a fallback outcome. The orchestrator
 * fans these out via Promise.all and one segment's fallback never affects
 * its siblings.
 *
 * Retry policy per brief Q7:
 *   - Transient (timeout, 429, 5xx): 1 retry inside withLLMRetry
 *     (maxAttempts=2: 1 initial + 1 retry) with backoff
 *   - Zod/clamp failures: 0 retries, immediate fallback
 *
 * File: src/agents/editor-agent.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { env } from '../config/env.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import { computeGeminiCost } from '../lib/llm-cost.js';
import { fetchKeyframeGrid } from '../lib/r2-fetch.js';

import {
  applyBatchClamps,
  applyClamps,
  editorBatchOutputSchema,
  editorRefinementSchema,
  validateBatchCompleteness,
  type BatchClampOutcome,
  type ClampOutcome,
  type EditorBatchOutput,
  type EditorBatchRefinement,
  type EditorRefinement,
} from './editor-agent-schema.js';

// ─── Public types ──────────────────────────────────────────────────────────

export type SlotRole = 'hook' | 'body' | 'close';

export interface EditorAgentInput {
  segmentId: string;
  originalStartS: number;
  originalEndS: number;
  segmentType: string;
  description: string | null;
  editorUse: string | null;
  /** Raw segment_v2 JSONB blob; the agent reads selected fields from it. */
  segmentV2: Record<string, unknown> | null;
  /** R2 key for the 4×3 keyframe grid mosaic (1024×1365 JPEG). */
  keyframeGridR2Key: string | null;
  /** Job-level idea seed — what the operator is trying to make. */
  ideaSeed: string;
  /** Where this segment sits in the routine. */
  slotRole: SlotRole;
  /**
   * v1.2.1 render-context fields. All Editor calls in one render receive
   * the same values; this is how per-segment-isolated parallel calls
   * coordinate on render-level pacing without inter-call communication.
   * See editor-agent-schema.ts renderContextFieldsSchema.
   */
  /** Total picked segments in this render. */
  slotCountTotal: number;
  /** This segment's position within the render (0-indexed). */
  slotIndex: number;
  /** Sum of all picked segments' (originalEndS - originalStartS). */
  currentRenderDurationS: number;
  /** Soft target render duration. Default 30s, ±5s acceptable. */
  targetRenderDurationS: number;
}

export type EditorAgentOutcome =
  | {
      kind: 'refined_ok';
      refinedStartS: number;
      refinedEndS: number;
      clamps: string[];
      reasoning: string;
      confidence: 'high' | 'medium' | 'low';
      costUsd: number;
      wallMs: number;
    }
  | {
      kind: 'no_change_needed';
      refinedStartS: number;
      refinedEndS: number;
      clamps: string[];
      reasoning: string;
      confidence: 'high' | 'medium' | 'low';
      costUsd: number;
      wallMs: number;
    }
  | {
      kind: 'fallback';
      reason: FallbackReason;
      refinedStartS: number;
      refinedEndS: number;
      clamps: string[];
      costUsd: number;
      wallMs: number;
    };

export type FallbackReason =
  | 'duration_floor_violated'
  | 'invalid_range'
  | 'zod_parse_failed'
  | 'transient_exhausted'
  | 'missing_keyframe_grid'
  | 'missing_segment_v2'
  | 'empty_response'
  | 'unknown_error';

// ─── Module-load constants ─────────────────────────────────────────────────

const MODEL_ID =
  process.env['GEMINI_EDITOR_MODEL'] ||
  process.env['GEMINI_CURATOR_MODEL'] ||
  'gemini-2.5-pro';

const TEMPERATURE = 0.2;
/** Brief Q7: 1 retry on transient = 1 initial + 1 retry = maxAttempts 2. */
const MAX_ATTEMPTS = 2;

const PROMPT_DIR = resolve(new URL('.', import.meta.url).pathname, './prompts');
const PROMPT_TEMPLATE = readFileSync(
  resolve(PROMPT_DIR, 'editor-agent.md'),
  'utf-8',
);

// ─── Public entry point ────────────────────────────────────────────────────

export async function refineSegmentBoundary(
  input: EditorAgentInput,
): Promise<EditorAgentOutcome> {
  const t0 = Date.now();

  // Defensive guards: brief says these should never happen given Match-Or-Match's
  // v2-only filter, but if they do we silently fall back.
  if (!input.keyframeGridR2Key) {
    return {
      kind: 'fallback',
      reason: 'missing_keyframe_grid',
      refinedStartS: input.originalStartS,
      refinedEndS: input.originalEndS,
      clamps: [],
      costUsd: 0,
      wallMs: Date.now() - t0,
    };
  }
  if (!input.segmentV2) {
    return {
      kind: 'fallback',
      reason: 'missing_segment_v2',
      refinedStartS: input.originalStartS,
      refinedEndS: input.originalEndS,
      clamps: [],
      costUsd: 0,
      wallMs: Date.now() - t0,
    };
  }

  let costUsd = 0;
  let raw: unknown = null;

  try {
    const grid = await fetchKeyframeGrid(input.keyframeGridR2Key);
    const prompt = renderPrompt(input);

    const result = await callGemini(grid, prompt, input.segmentId);
    costUsd = result.costUsd;
    raw = result.raw;
  } catch (err) {
    const reason: FallbackReason = isTransientLike(err) ? 'transient_exhausted' : 'unknown_error';
    console.warn(
      `[editor-agent] segment=${input.segmentId} ${reason}: ${messageOf(err)}`,
    );
    return {
      kind: 'fallback',
      reason,
      refinedStartS: input.originalStartS,
      refinedEndS: input.originalEndS,
      clamps: [],
      costUsd,
      wallMs: Date.now() - t0,
    };
  }

  // Zod validation → 0 retries on parse failures per brief Q7.
  let parsed: EditorRefinement;
  try {
    parsed = editorRefinementSchema.parse(raw);
  } catch (err) {
    console.warn(
      `[editor-agent] segment=${input.segmentId} zod_parse_failed: ${messageOf(err)}. ` +
        `Raw: ${JSON.stringify(raw).slice(0, 200)}`,
    );
    return {
      kind: 'fallback',
      reason: 'zod_parse_failed',
      refinedStartS: input.originalStartS,
      refinedEndS: input.originalEndS,
      clamps: [],
      costUsd,
      wallMs: Date.now() - t0,
    };
  }

  // segment_id mismatch is a structural error — model returned a refinement
  // for a different segment. Fall back rather than trust the bounds.
  if (parsed.segment_id !== input.segmentId) {
    console.warn(
      `[editor-agent] segment=${input.segmentId} returned segment_id=${parsed.segment_id} (mismatch). Falling back.`,
    );
    return {
      kind: 'fallback',
      reason: 'zod_parse_failed',
      refinedStartS: input.originalStartS,
      refinedEndS: input.originalEndS,
      clamps: [],
      costUsd,
      wallMs: Date.now() - t0,
    };
  }

  const clampOutcome = applyClamps(parsed, {
    startS: input.originalStartS,
    endS: input.originalEndS,
  });
  return projectOutcome(clampOutcome, parsed, costUsd, Date.now() - t0);
}

// ─── Internal: Gemini call ─────────────────────────────────────────────────

async function callGemini(
  grid: Buffer,
  prompt: string,
  segmentId: string,
): Promise<{ raw: unknown; costUsd: number }> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  // Rule 35: image input first, then text instructions.
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: grid.toString('base64'),
      },
    },
    { text: prompt },
  ];

  const response = await withLLMRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          temperature: TEMPERATURE,
        },
      }),
    { label: `editor-agent segment=${segmentId}`, maxAttempts: MAX_ATTEMPTS },
  );

  const text = response.text ?? '';
  if (!text) {
    throw new Error('editor-agent: Gemini returned empty text');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `editor-agent: response not parseable as JSON. Raw: ${text.slice(0, 200)}`,
      );
    }
    raw = JSON.parse(match[0]);
  }

  const usage = computeGeminiCost(MODEL_ID, response);
  return { raw, costUsd: usage.cost_usd };
}

// ─── Internal: prompt rendering ────────────────────────────────────────────

function renderPrompt(input: EditorAgentInput): string {
  // Field paths verified against production nordpilates v2 rows in c3
  // spot-check: motion, audio, quality, editorial all present at v2 root.
  // setting.on_screen_text is nested but always null in current data — we
  // surface it defensively in case backfill populates it later.
  const v2 = input.segmentV2 ?? {};
  const motion = pickPath<unknown>(v2, ['motion']);
  const audio = pickPath<unknown>(v2, ['audio']);
  const quality = pickPath<unknown>(v2, ['quality']);
  const editorial = pickPath<unknown>(v2, ['editorial']);
  const onScreenText = pickPath<unknown>(v2, ['setting', 'on_screen_text']);
  const subjectPresent = pickPath<boolean>(v2, ['subject', 'present']);

  return PROMPT_TEMPLATE.replace(/\{segment_id\}/g, input.segmentId)
    .replace(/\{original_start_s\}/g, fmt(input.originalStartS))
    .replace(/\{original_end_s\}/g, fmt(input.originalEndS))
    .replace(
      /\{original_duration_s\}/g,
      fmt(input.originalEndS - input.originalStartS),
    )
    .replace(/\{segment_type\}/g, input.segmentType)
    .replace(/\{description\}/g, input.description ?? '(none)')
    .replace(/\{idea_seed\}/g, input.ideaSeed)
    .replace(/\{slot_role\}/g, input.slotRole)
    .replace(/\{motion_block\}/g, jsonOrNone(motion))
    .replace(/\{audio_block\}/g, jsonOrNone(audio))
    .replace(/\{quality_block\}/g, jsonOrNone(quality))
    .replace(/\{editorial_block\}/g, jsonOrNone(editorial))
    .replace(
      /\{on_screen_text\}/g,
      typeof onScreenText === 'string' ? onScreenText : '(none)',
    )
    .replace(
      /\{subject_present\}/g,
      typeof subjectPresent === 'boolean' ? String(subjectPresent) : '(unknown)',
    )
    // v1.2.1 render-context placeholders
    .replace(/\{slot_index\}/g, String(input.slotIndex))
    .replace(/\{slot_count_total\}/g, String(input.slotCountTotal))
    .replace(
      /\{current_render_duration_s\}/g,
      fmt(input.currentRenderDurationS),
    )
    .replace(
      /\{target_render_duration_s\}/g,
      fmt(input.targetRenderDurationS),
    );
}

function pickPath<T>(obj: Record<string, unknown>, path: string[]): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur as T;
}

function jsonOrNone(value: unknown): string {
  if (value === undefined || value === null) return '(none)';
  return JSON.stringify(value);
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// ─── Internal: outcome projection ──────────────────────────────────────────

function projectOutcome(
  c: ClampOutcome,
  parsed: EditorRefinement,
  costUsd: number,
  wallMs: number,
): EditorAgentOutcome {
  switch (c.kind) {
    case 'refined_ok':
      return {
        kind: 'refined_ok',
        refinedStartS: c.refinedStartS,
        refinedEndS: c.refinedEndS,
        clamps: c.clamps,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
        costUsd,
        wallMs,
      };
    case 'no_change_needed':
      return {
        kind: 'no_change_needed',
        refinedStartS: c.refinedStartS,
        refinedEndS: c.refinedEndS,
        clamps: c.clamps,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
        costUsd,
        wallMs,
      };
    case 'fallback':
      return {
        kind: 'fallback',
        reason: c.reason,
        refinedStartS: c.refinedStartS,
        refinedEndS: c.refinedEndS,
        clamps: c.clamps,
        costUsd,
        wallMs,
      };
  }
}

// ─── Internal: error classification ────────────────────────────────────────

function isTransientLike(err: unknown): boolean {
  // After withLLMRetry exhausts, the original error surfaces. If it walked the
  // retry path (status code in retry list, network code, retry message), it
  // was transient. Otherwise treat as unknown_error.
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : null;
  if (status !== null && [429, 502, 503, 504, 529, 500].includes(status)) {
    return true;
  }
  if (typeof e.code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(e.code)) {
    return true;
  }
  const msg = messageOf(err).toLowerCase();
  return /timeout|rate limit|overloaded|socket|empty text/.test(msg);
}

function messageOf(err: unknown): string {
  if (err == null) return 'unknown';
  if (err instanceof Error) return err.message;
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join('.')}=${i.message}`).join('; ');
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v1.3 BATCH ARCHITECTURE (single-call holistic with drop authority)
// ═══════════════════════════════════════════════════════════════════════════
//
// Replaces v1.2.x's per-segment Promise.all parallel calls with ONE Gemini
// multimodal call that sees all N segments at once and returns refinements
// for all N in one response. New `drop` action: model can exclude weak
// segments from the render. Drop GUARDS (under-band floor projection,
// slot count minimum) are orchestrator-side per brief §5b.
//
// The legacy `refineSegmentBoundary` above remains exported until c6
// swaps the orchestrator to use `refineSegmentBatch`. Both functions
// read the same `editor-agent.md` prompt file (system instruction);
// c4 rewrites that file's content for batch use.
//
// Failure model per brief Q3: all-or-nothing batch fallback. If the
// single call fails (transient, Zod, completeness mismatch), the entire
// batch falls back to original boundaries — no per-segment partial
// success/fail mixing.

// ─── v1.3 input / outcome types ────────────────────────────────────────────

/** One segment's input within a batch. */
export interface EditorBatchSegmentInput {
  segmentId: string;
  originalStartS: number;
  originalEndS: number;
  segmentType: string;
  description: string | null;
  /** Raw segment_v2 JSONB blob; the agent reads selected fields. */
  segmentV2: Record<string, unknown> | null;
  /** R2 key for the 4×3 keyframe grid mosaic (1024×1365 JPEG). */
  keyframeGridR2Key: string | null;
}

/** Top-level batch input. Render-context fields are once per batch. */
export interface EditorBatchAgentInput {
  segments: EditorBatchSegmentInput[];
  ideaSeed: string;
  slotCountTotal: number;
  /** Sum of all picked segments' original (endS - startS). */
  currentRenderDurationS: number;
  /** Soft target render duration. Default 30s. */
  targetRenderDurationS: number;
}

export type BatchFallbackReason =
  | 'empty_input'
  | 'missing_keyframe_grid'
  | 'missing_segment_v2'
  | 'transient_exhausted'
  | 'empty_response'
  | 'json_parse_failed'
  | 'zod_parse_failed'
  | 'completeness_failed'
  | 'unknown_error';

/** One segment's outcome within a batch. */
export type EditorBatchPerSegmentOutcome =
  | {
      kind: 'refined';
      segmentId: string;
      refinedStartS: number;
      refinedEndS: number;
      reasoning: string;
      confidence: 'high' | 'medium' | 'low';
      clamps: string[];
    }
  | {
      kind: 'no_change';
      segmentId: string;
      refinedStartS: number;
      refinedEndS: number;
      reasoning: string;
      confidence: 'high' | 'medium' | 'low';
      clamps: string[];
    }
  | {
      kind: 'drop';
      segmentId: string;
      reasoning: string;
      confidence: 'high' | 'medium' | 'low';
      clamps: string[];
    }
  | {
      kind: 'fallback';
      segmentId: string;
      /** Original bounds preserved when batch falls back. */
      refinedStartS: number;
      refinedEndS: number;
      /** Reason inherited from batch-level fallback OR per-segment clamp failure. */
      perSegmentFallbackReason: 'duration_floor_violated' | 'invalid_range' | 'missing_refined_bounds' | 'batch_fallback';
      clamps: string[];
    };

export interface EditorBatchAgentOutcome {
  perSegment: EditorBatchPerSegmentOutcome[];
  /** Model's batch-level reasoning. Null when the batch fell back. */
  globalReasoning: string | null;
  /** True when the entire batch fell back (Q3: all-or-nothing). */
  batchFallback: boolean;
  /** Set when batchFallback=true. Null otherwise. */
  batchFallbackReason: BatchFallbackReason | null;
  costUsd: number;
  wallMs: number;
}

// ─── v1.3 public entry point ───────────────────────────────────────────────

/**
 * Single-call batch boundary refinement.
 *
 * Returns an outcome wrapper with per-segment results + global_reasoning.
 * NEVER throws. All failure paths return a batch-fallback outcome where
 * every segment's outcome is `kind: 'fallback'` with original bounds
 * preserved.
 */
export async function refineSegmentBatch(
  input: EditorBatchAgentInput,
): Promise<EditorBatchAgentOutcome> {
  const t0 = Date.now();

  if (input.segments.length === 0) {
    return makeBatchFallback(input, 'empty_input', 0, Date.now() - t0);
  }

  // Defensive: every segment must have keyframe grid + segment_v2.
  for (const s of input.segments) {
    if (!s.keyframeGridR2Key) {
      return makeBatchFallback(input, 'missing_keyframe_grid', 0, Date.now() - t0);
    }
    if (!s.segmentV2) {
      return makeBatchFallback(input, 'missing_segment_v2', 0, Date.now() - t0);
    }
  }

  let costUsd = 0;
  let rawText = '';

  try {
    // Fetch N keyframe grids in parallel (network I/O, not Gemini cost).
    const grids = await Promise.all(
      input.segments.map((s) => fetchKeyframeGrid(s.keyframeGridR2Key as string)),
    );
    const systemInstruction = PROMPT_TEMPLATE; // c4 swaps this file's content for v1.3
    const structuredInput = buildStructuredBatchInput(input);
    const result = await callGeminiBatch(grids, systemInstruction, structuredInput);
    costUsd = result.costUsd;
    rawText = result.rawText;
  } catch (err) {
    const reason: BatchFallbackReason = isTransientLike(err)
      ? 'transient_exhausted'
      : 'unknown_error';
    console.warn(`[editor-batch] ${reason}: ${messageOf(err)}`);
    return makeBatchFallback(input, reason, costUsd, Date.now() - t0);
  }

  return assembleBatchOutcome(rawText, input, costUsd, Date.now() - t0);
}

/**
 * Pure function: parse + validate + clamp + assemble per-segment outcomes
 * from a raw model response string + the batch input. Exported for
 * standalone testing (see src/scripts/test-editor-batch-call.ts) without
 * requiring a live Gemini call.
 */
export function assembleBatchOutcome(
  rawText: string,
  input: EditorBatchAgentInput,
  costUsd: number,
  wallMs: number,
): EditorBatchAgentOutcome {
  if (!rawText) {
    return makeBatchFallback(input, 'empty_response', costUsd, wallMs);
  }

  // 1. JSON parse (with brace-extraction fallback for prose-prefixed responses)
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn(`[editor-batch] json_parse_failed: ${rawText.slice(0, 200)}`);
      return makeBatchFallback(input, 'json_parse_failed', costUsd, wallMs);
    }
    try {
      raw = JSON.parse(match[0]);
    } catch (err2) {
      console.warn(`[editor-batch] json_parse_failed (after brace extraction): ${messageOf(err2)}`);
      return makeBatchFallback(input, 'json_parse_failed', costUsd, wallMs);
    }
  }

  // 2. Zod parse
  const zodResult = editorBatchOutputSchema.safeParse(raw);
  if (!zodResult.success) {
    console.warn(
      `[editor-batch] zod_parse_failed: ${zodResult.error.issues
        .map((i) => `${i.path.join('.')}=${i.message}`)
        .slice(0, 5)
        .join('; ')}`,
    );
    return makeBatchFallback(input, 'zod_parse_failed', costUsd, wallMs);
  }
  const batch: EditorBatchOutput = zodResult.data;

  // 3. Completeness check (every input segment_id present once in output)
  const expectedIds = input.segments.map((s) => s.segmentId);
  const completeness = validateBatchCompleteness(batch, expectedIds);
  if (!completeness.ok) {
    console.warn(
      `[editor-batch] completeness_failed: ${completeness.issues
        .slice(0, 5)
        .map((i) => `${i.kind}:${i.segmentId.slice(0, 8)}`)
        .join('; ')}`,
    );
    return makeBatchFallback(input, 'completeness_failed', costUsd, wallMs);
  }

  // 4. Per-segment clamp + projection.
  const inputBySegmentId = new Map(input.segments.map((s) => [s.segmentId, s]));
  const refinementBySegmentId = new Map(batch.refinements.map((r) => [r.segment_id, r]));

  const perSegment: EditorBatchPerSegmentOutcome[] = input.segments.map((seg) => {
    const refinement = refinementBySegmentId.get(seg.segmentId) as EditorBatchRefinement;
    const original = { startS: seg.originalStartS, endS: seg.originalEndS };
    const clamp: BatchClampOutcome = applyBatchClamps(refinement, original);
    return projectBatchPerSegmentOutcome(seg.segmentId, original, refinement, clamp);
  });

  void inputBySegmentId; // reserved for future cross-segment logic

  return {
    perSegment,
    globalReasoning: batch.global_reasoning,
    batchFallback: false,
    batchFallbackReason: null,
    costUsd,
    wallMs,
  };
}

// ─── v1.3 internal helpers ─────────────────────────────────────────────────

function makeBatchFallback(
  input: EditorBatchAgentInput,
  reason: BatchFallbackReason,
  costUsd: number,
  wallMs: number,
): EditorBatchAgentOutcome {
  return {
    perSegment: input.segments.map((s) => ({
      kind: 'fallback' as const,
      segmentId: s.segmentId,
      refinedStartS: s.originalStartS,
      refinedEndS: s.originalEndS,
      perSegmentFallbackReason: 'batch_fallback' as const,
      clamps: [],
    })),
    globalReasoning: null,
    batchFallback: true,
    batchFallbackReason: reason,
    costUsd,
    wallMs,
  };
}

function projectBatchPerSegmentOutcome(
  segmentId: string,
  original: { startS: number; endS: number },
  refinement: EditorBatchRefinement,
  clamp: BatchClampOutcome,
): EditorBatchPerSegmentOutcome {
  switch (clamp.kind) {
    case 'refined_ok':
      return {
        kind: 'refined',
        segmentId,
        refinedStartS: clamp.refinedStartS,
        refinedEndS: clamp.refinedEndS,
        reasoning: refinement.reasoning,
        confidence: refinement.confidence,
        clamps: clamp.clamps,
      };
    case 'no_change':
      return {
        kind: 'no_change',
        segmentId,
        refinedStartS: clamp.refinedStartS,
        refinedEndS: clamp.refinedEndS,
        reasoning: refinement.reasoning,
        confidence: refinement.confidence,
        clamps: clamp.clamps,
      };
    case 'drop':
      return {
        kind: 'drop',
        segmentId,
        reasoning: clamp.reasoning,
        confidence: refinement.confidence,
        clamps: clamp.clamps,
      };
    case 'fallback':
      return {
        kind: 'fallback',
        segmentId,
        refinedStartS: original.startS,
        refinedEndS: original.endS,
        perSegmentFallbackReason: clamp.reason,
        clamps: clamp.clamps,
      };
  }
}

function buildStructuredBatchInput(input: EditorBatchAgentInput): string {
  // Emits a JSON text block paired with the N keyframe grid images.
  // Image at index i corresponds to segments[i]; the prompt explains.
  const segments = input.segments.map((s, i) => {
    const v2 = s.segmentV2 ?? {};
    return {
      image_index: i,
      segment_id: s.segmentId,
      original_start_s: Number(s.originalStartS.toFixed(2)),
      original_end_s: Number(s.originalEndS.toFixed(2)),
      original_duration_s: Number((s.originalEndS - s.originalStartS).toFixed(2)),
      segment_type: s.segmentType,
      description: s.description ?? null,
      motion: pickPath<unknown>(v2, ['motion']) ?? null,
      audio: pickPath<unknown>(v2, ['audio']) ?? null,
      quality: pickPath<unknown>(v2, ['quality']) ?? null,
      editorial: pickPath<unknown>(v2, ['editorial']) ?? null,
      on_screen_text: pickPath<unknown>(v2, ['setting', 'on_screen_text']) ?? null,
      subject_present: pickPath<boolean>(v2, ['subject', 'present']) ?? null,
    };
  });
  const renderContext = {
    idea_seed: input.ideaSeed,
    slot_count_total: input.slotCountTotal,
    current_render_duration_s: Number(input.currentRenderDurationS.toFixed(2)),
    target_render_duration_s: Number(input.targetRenderDurationS.toFixed(2)),
  };
  return [
    'BATCH INPUT — N segments to refine in one call.',
    `Image at index i corresponds to segments[i] (i = 0..${segments.length - 1}).`,
    '',
    'render_context:',
    JSON.stringify(renderContext, null, 2),
    '',
    'segments:',
    JSON.stringify(segments, null, 2),
  ].join('\n');
}

async function callGeminiBatch(
  grids: Buffer[],
  systemInstruction: string,
  structuredInput: string,
): Promise<{ rawText: string; costUsd: number }> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  // Rule 35: images first, then text. N image parts followed by the
  // structured input + system instruction text.
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = grids.map((g) => ({
    inlineData: { mimeType: 'image/jpeg', data: g.toString('base64') },
  }));
  parts.push({ text: `${structuredInput}\n\n---\n\n${systemInstruction}` });

  const response = await withLLMRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          temperature: TEMPERATURE,
        },
      }),
    { label: `editor-batch n=${grids.length}`, maxAttempts: MAX_ATTEMPTS },
  );

  const text = response.text ?? '';
  if (!text) {
    throw new Error('editor-batch: Gemini returned empty text');
  }
  const usage = computeGeminiCost(MODEL_ID, response);
  return { rawText: text, costUsd: usage.cost_usd };
}
