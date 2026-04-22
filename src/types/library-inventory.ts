/**
 * W3 library inventory — structured snapshot of what's on the shelf for
 * the Planner to design against. Built by `src/agents/library-inventory-v2.ts`
 * from `asset_segments` + `segment_v2`. Not to be confused with the Phase 3.5
 * `src/agents/library-inventory.ts` aggregator, which emits a different shape
 * tailored to the Milestone 3.5 library-aware CD.
 *
 * File: src/types/library-inventory.ts
 */

import { z } from 'zod';

export const LibraryInventoryTotalsSchema = z.object({
  parents: z.number().int().min(0),
  segments: z.number().int().min(0),
  v2_segments: z.number().int().min(0),
  gridded_segments: z.number().int().min(0),
});

export const LibraryInventoryBRollMixSchema = z.object({
  lifestyle_likely: z.number().int().min(0),
  exercise_adjacent_likely: z.number().int().min(0),
  ambiguous: z.number().int().min(0),
});

export const LibraryInventorySchema = z.object({
  brand_id: z.string().min(1),
  generated_at: z.string().min(1),
  totals: LibraryInventoryTotalsSchema,
  // 8-value segment_type enum; zero-count keys are fine.
  segment_type_counts: z.record(z.string(), z.number().int().min(0)),
  body_regions: z.array(
    z.object({
      region: z.string().min(1),
      count: z.number().int().min(1),
    }),
  ),
  equipment: z.array(
    z.object({
      equipment: z.string().min(1),
      count: z.number().int().min(1),
    }),
  ),
  top_exercises: z.array(
    z.object({
      name: z.string().min(1),
      count: z.number().int().min(2),
    }),
  ),
  b_roll_mix: LibraryInventoryBRollMixSchema,
  long_hold_count: z.number().int().min(0),
  talking_head_count: z.number().int().min(0),
});

export type LibraryInventory = z.infer<typeof LibraryInventorySchema>;
export type LibraryInventoryTotals = z.infer<typeof LibraryInventoryTotalsSchema>;
export type LibraryInventoryBRollMix = z.infer<typeof LibraryInventoryBRollMixSchema>;
