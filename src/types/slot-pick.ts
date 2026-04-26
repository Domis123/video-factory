/**
 * SlotPick — Visual Director's per-slot output (W5).
 *
 * Two Zod surfaces live here:
 *   1. `GeminiPickResponseSchema` — minimal shape the model is asked to emit. Kept
 *      narrow so `stripSchemaBounds()` has less to strip and `responseSchema` has
 *      less to reject.
 *   2. `SlotPickSchema` — final per-slot record. Model output + diagnostics the
 *      wrapper joins from the W4 candidate set + orchestrator state.
 *
 * `StoryboardPicksSchema` wraps the full fan-out result with latency + parallel
 * speedup ratio.
 *
 * File: src/types/slot-pick.ts
 */

import { z } from 'zod';

export const GeminiPickResponseSchema = z.object({
  picked_segment_id: z.string().uuid(),
  in_point_s: z.number().min(0),
  out_point_s: z.number().positive(),
  reasoning: z.string().min(20).max(400),
});

export type GeminiPickResponse = z.infer<typeof GeminiPickResponseSchema>;

export const SlotPickSchema = z.object({
  slot_index: z.number().int().min(0),
  picked_segment_id: z.string().uuid(),
  parent_asset_id: z.string().uuid(),
  in_point_s: z.number().min(0),
  out_point_s: z.number().positive(),
  duration_s: z.number().positive(),
  reasoning: z.string().min(20).max(500),
  // Diagnostics — populated wrapper-side, not by Gemini.
  similarity: z.number(),
  was_relaxed_match: z.boolean(),
  same_parent_as_primary: z.boolean().nullable(),
  latency_ms: z.number().int().nonnegative(),
  // W9.1 — per-slot Gemini USD spend (this slot's pick call). Wrapper-populated.
  cost_usd: z.number().min(0).default(0),
});

export type SlotPick = z.infer<typeof SlotPickSchema>;

export const StoryboardPicksSchema = z.object({
  picks: z.array(SlotPickSchema),
  total_latency_ms: z.number().int().nonnegative(),
  parallel_speedup_ratio: z.number(),
  // W9.1 — sum of per-slot cost_usd. Convenience aggregate so the orchestrator
  // doesn't have to re-sum on every revise loop.
  cost_usd: z.number().min(0).default(0),
});

export type StoryboardPicks = z.infer<typeof StoryboardPicksSchema>;
