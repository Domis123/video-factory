/**
 * CopyPackage — Copywriter (W7) output.
 *
 * Part B Copywriter. Post-select, post-W5 Director, independent of Critic.
 * Pure function: (PlannerOutput, StoryboardPicks, BrandPersona, segment_snapshots) → CopyPackage.
 *
 * Single Gemini text-only call produces the whole package. Seven semantic
 * validation checks run after Zod parse (Rule 38 — loud throws, no silent
 * correct). Each check has a distinct error class so the W8 orchestrator can
 * distinguish retriable (LLM variance) from non-retriable (prompt bug).
 *
 * `voiceover_script: z.null()` is a W7 placeholder. W10 widens to
 * `z.string().nullable()` when voice generation lands.
 *
 * File: src/types/copywriter-output.ts
 */

import { z } from 'zod';

export const OVERLAY_TYPE_VALUES = [
  'label',    // names the exercise ("glute bridge")
  'cue',      // instructional cue ("shoulders down", "neutral spine", "BREATHE")
  'stamp',    // high-contrast emphasis ("WRONG", "RIGHT", "HOLD")
  'caption',  // narrative text, full sentences
  'count',    // rep counter ("3 of 5", "12 reps")
  'none',     // no overlay on this slot
] as const;
export type OverlayType = (typeof OVERLAY_TYPE_VALUES)[number];

export const HOOK_DELIVERY_VALUES = ['overlay', 'spoken', 'both'] as const;
export type HookDelivery = (typeof HOOK_DELIVERY_VALUES)[number];

export const CopywriterVersionSchema = z.literal('w7-v1');

export const CopyPackageSchema = z.object({
  per_slot: z
    .array(
      z.object({
        slot_id: z.string(),
        overlay: z.object({
          type: z.enum(OVERLAY_TYPE_VALUES),
          text: z.string().nullable(),
          start_time_s: z.number().min(0),
          end_time_s: z.number().min(0),
        }),
        reasoning: z.string().min(10).max(300),
      }),
    )
    .min(1),

  hook: z.object({
    text: z.string().min(1).max(120),
    delivery: z.enum(HOOK_DELIVERY_VALUES),
    mechanism_tie: z.string().min(10).max(200),
  }),

  cta_text: z.string().nullable(),

  captions: z.object({
    canonical: z.string().min(1).max(300),
    tiktok: z.string().max(150),
    instagram: z.string().max(2200),
    youtube: z.string().max(5000),
  }),

  hashtags: z.array(z.string().regex(/^#[a-zA-Z0-9_]+$/)).min(3).max(15),

  // W10 widens to z.string().nullable() when voice generation lands.
  voiceover_script: z.null(),

  metadata: z.object({
    copywriter_version: CopywriterVersionSchema,
    temperature: z.number(),
    retry_count: z.number().int().min(0),
  }),

  // W9.1 — Gemini USD spend on this copywriter call (whichever attempt
  // succeeded — parse-retry attempts are not summed). Wrapper-populated.
  cost_usd: z.number().min(0).default(0),
});

export type CopyPackage = z.infer<typeof CopyPackageSchema>;
export type CopySlot = CopyPackage['per_slot'][number];
export type CopyOverlay = CopySlot['overlay'];
export type CopyHook = CopyPackage['hook'];
export type CopyCaptions = CopyPackage['captions'];

/**
 * Semantic validation error classes. Rule 38: loud throw, never silent correct.
 * W8 orchestrator catches these and decides retry-vs-surface per class:
 *   - OverlayTypeConstraintError: prompt bug (model chose a type whose
 *     preconditions aren't met by the slot) → surface, do not retry.
 *   - OverlayTimingError: prompt bug (timing bounds exceeded slot duration)
 *     → surface, do not retry.
 *   - OverlayTextNullError: prompt bug (text↔type coherence broken)
 *     → surface, do not retry.
 *   - HookDeliveryCoherenceError: prompt bug (delivery claims vs evidence
 *     mismatch) → surface, do not retry.
 *   - CaptionSanityError: prompt bug (TikTok dropped the hashtag-as-hook
 *     convention when hashtags exist) → surface, do not retry.
 *   - HashtagFormatError: prompt bug (duplicates or leading whitespace past
 *     Zod regex) → surface, do not retry.
 *   - OnScreenTextCollisionError: prompt bug (overlay text duplicates visible
 *     on_screen_text substring) → surface, do not retry.
 *
 * Network / parse / Zod failures are retriable by the wrapper itself.
 */
export class CopywriterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopywriterValidationError';
  }
}

export class OverlayTypeConstraintError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayTypeConstraintError';
  }
}

export class OverlayTimingError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayTimingError';
  }
}

export class OverlayTextNullError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayTextNullError';
  }
}

export class HookDeliveryCoherenceError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'HookDeliveryCoherenceError';
  }
}

export class CaptionSanityError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'CaptionSanityError';
  }
}

export class HashtagFormatError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'HashtagFormatError';
  }
}

export class OnScreenTextCollisionError extends CopywriterValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'OnScreenTextCollisionError';
  }
}
