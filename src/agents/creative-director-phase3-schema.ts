import { z } from 'zod';
import type { Phase3CreativeBrief } from '../types/database.js';

const colorTreatmentSchema = z.enum([
  'warm-vibrant', 'cool-muted', 'high-contrast', 'soft-pastel',
  'moody-dark', 'natural', 'golden-hour', 'clean-bright',
]);

const transitionInSchema = z.enum([
  'hard-cut', 'crossfade', 'slide', 'zoom',
  'whip-pan', 'fade-from-black',
]);

const internalCutStyleSchema = z.enum(['hold', 'hard-cuts', 'soft-cuts']);

const overlayStyleSchema = z.enum([
  'bold-center', 'subtitle', 'label', 'cta', 'minimal', 'none',
]);

const overlayPositionSchema = z.enum([
  'top-left', 'top-center', 'top-right',
  'center',
  'bottom-left', 'bottom-center', 'bottom-right',
]);

const overlayAnimationSchema = z.enum([
  'pop-in', 'slide-up', 'fade', 'type-on', 'none',
]);

const musicTempoSchema = z.enum(['slow', 'medium', 'fast']);

const segmentTypeSchema = z.enum(['hook', 'body', 'cta']);

const subjectConsistencySchema = z.enum(['single-subject', 'prefer-same', 'mixed']);

const pacingSchema = z.enum(['slow', 'medium', 'fast']);

const phase3BriefSegmentSchema = z.object({
  type: segmentTypeSchema,
  label: z.string(),
  pacing: pacingSchema,
  cut_duration_target_s: z.number(),
  transition_in: transitionInSchema,
  internal_cut_style: internalCutStyleSchema,
  text_overlay: z.object({
    style: overlayStyleSchema,
    position: overlayPositionSchema,
    animation: overlayAnimationSchema,
    char_target: z.number().int().min(10).max(60),
  }),
  clip_requirements: z.object({
    mood: z.string(),
    has_speech: z.boolean(),
    min_quality: z.number(),
    content_type: z.array(z.string()),
    visual_elements: z.array(z.string()),
    body_focus: z.string().nullable(),
    aesthetic_guidance: z.string(),
  }),
});

export const phase3CreativeBriefSchema = z
  .object({
    brief_id: z.string(),
    brand_id: z.string(),
    video_type: z.string(),
    composition_id: z.literal('phase3-parameterized-v1'),
    total_duration_target: z.number(),
    caption_preset: z.string(),
    idea_seed: z.string(),
    vibe: z.string().nullable(),
    creative_direction: z.object({
      creative_vision: z.string(),
      slot_count: z.number().int().min(3).max(12),
      energy_per_slot: z.array(z.number().int().min(1).max(10)),
      color_treatment: colorTreatmentSchema,
      subject_consistency: subjectConsistencySchema,
    }),
    segments: z.array(phase3BriefSegmentSchema),
    audio: z.object({
      strategy: z.literal('music-primary'),
      music: z.object({
        mood: z.string(),
        tempo: musicTempoSchema,
        energy_level: z.number().int().min(1).max(10),
        volume_level: z.number().min(0).max(1),
        pinned_track_id: z.string().nullable(),
      }),
    }),
  })
  .superRefine((brief, ctx) => {
    if (brief.creative_direction.energy_per_slot.length !== brief.creative_direction.slot_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `energy_per_slot length (${brief.creative_direction.energy_per_slot.length}) must equal slot_count (${brief.creative_direction.slot_count})`,
        path: ['creative_direction', 'energy_per_slot'],
      });
    }
    if (brief.segments.length !== brief.creative_direction.slot_count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `segments length (${brief.segments.length}) must equal slot_count (${brief.creative_direction.slot_count})`,
        path: ['segments'],
      });
    }
    if (brief.segments[0]?.type !== 'hook') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "segments[0].type must be 'hook'",
        path: ['segments', 0, 'type'],
      });
    }
  });

export function validatePhase3Brief(raw: unknown): Phase3CreativeBrief {
  return phase3CreativeBriefSchema.parse(raw);
}

// Type-equality assertion: keeps the manual interface in `database.ts` and the
// Zod-inferred type in lockstep. If this fails to compile, one side has drifted.
type _AssertEqual<T, U> = (<V>() => V extends T ? 1 : 2) extends (<V>() => V extends U ? 1 : 2)
  ? true
  : false;
const _check: _AssertEqual<Phase3CreativeBrief, z.infer<typeof phase3CreativeBriefSchema>> = true;
void _check;
