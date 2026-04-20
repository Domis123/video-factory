import { z } from 'zod';

export const segmentTypeV2Schema = z.enum([
  'setup',
  'exercise',
  'transition',
  'hold',
  'cooldown',
  'talking-head',
  'b-roll',
  'unusable',
]);

const subjectPrimarySchema = z.object({
  hair_color: z.enum(['blonde', 'brunette', 'black', 'red', 'gray', 'other', 'unclear']),
  hair_style: z.enum(['loose', 'ponytail', 'bun', 'braid', 'short', 'other', 'unclear']),
  top_color: z.string().min(1),
  top_type: z.enum(['sports-bra', 'tank', 't-shirt', 'long-sleeve', 'crop', 'hoodie', 'other']),
  bottom_color: z.string(),
  bottom_type: z.enum(['leggings', 'shorts', 'joggers', 'bare-legs', 'other']),
  build: z.enum(['slim', 'athletic', 'average', 'curvy', 'muscular', 'unclear']),
});

const subjectSchema = z.object({
  present: z.boolean(),
  count: z.enum(['1', '2', '3+']),
  primary: subjectPrimarySchema.nullable(),
});

const exerciseSchema = z.object({
  name: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  body_regions: z.array(z.string()).max(5),
  form_cues_visible: z.array(z.string()).max(8),
});

const motionSchema = z.object({
  velocity: z.enum(['static', 'slow', 'moderate', 'fast']),
  range: z.enum(['micro', 'small', 'medium', 'large']),
  tempo: z.enum(['steady', 'accelerating', 'decelerating', 'varied']),
  rep_count_visible: z.number().int().min(0).nullable(),
  movement_phase: z.enum(['setup', 'active-reps', 'hold', 'release', 'transition']),
});

const framingSchema = z.object({
  angle: z.enum(['front', 'side', 'three-quarter', 'overhead', 'low', 'back']),
  distance: z.enum(['close-up', 'medium', 'wide']),
  stability: z.enum(['locked', 'minor-drift', 'handheld-shaky']),
  subject_position: z.enum(['center', 'left-third', 'right-third', 'off-center']),
});

const settingSchema = z.object({
  location: z.enum(['studio', 'home', 'gym', 'outdoor', 'other']),
  lighting_quality: z.enum(['bright-natural', 'warm-indoor', 'cool-indoor', 'mixed', 'dim']),
  equipment_visible: z.array(z.string()).max(8),
});

const qualitySchema = z.object({
  sharpness: z.number().int().min(1).max(5),
  lighting: z.number().int().min(1).max(5),
  subject_visibility: z.number().int().min(1).max(5),
  shakiness: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(10),
});

const unusableIntervalSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  reason: z.string().min(1),
});

const editorialSchema = z.object({
  best_in_point_s: z.number().min(0),
  best_out_point_s: z.number().min(0),
  unusable_intervals: z.array(unusableIntervalSchema),
  hook_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
  demo_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
  transition_suitability: z.enum(['excellent', 'good', 'poor', 'unsuitable']),
});

const speechSchema = z.object({
  has_speech: z.boolean(),
  transcript_snippet: z.string().max(100).nullable(),
  speech_intent: z.enum(['instruction', 'inspiration', 'narration', 'ambient', 'none']),
});

export const SegmentV2Schema = z
  .object({
    start_s: z.number().min(0),
    end_s: z.number().min(0),
    segment_type: segmentTypeV2Schema,
    subject: subjectSchema,
    exercise: exerciseSchema,
    motion: motionSchema,
    framing: framingSchema,
    setting: settingSchema,
    quality: qualitySchema,
    editorial: editorialSchema,
    speech: speechSchema,
    description: z.string().min(50).max(500),
    visual_tags: z.array(z.string()).min(8).max(15),
    recommended_duration_s: z.number().min(0),
    schema_version: z.literal('2'),
  })
  .superRefine((seg, ctx) => {
    if (seg.end_s <= seg.start_s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_s'],
        message: `end_s (${seg.end_s}) must be greater than start_s (${seg.start_s})`,
      });
    }
    const inS = seg.editorial.best_in_point_s;
    const outS = seg.editorial.best_out_point_s;
    if (inS < seg.start_s || inS > seg.end_s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editorial', 'best_in_point_s'],
        message: `best_in_point_s (${inS}) must be within [${seg.start_s}, ${seg.end_s}]`,
      });
    }
    if (outS < inS || outS > seg.end_s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editorial', 'best_out_point_s'],
        message: `best_out_point_s (${outS}) must be within [${inS}, ${seg.end_s}]`,
      });
    }
    if (seg.segment_type !== 'unusable' && seg.recommended_duration_s < 1.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommended_duration_s'],
        message: `recommended_duration_s must be >= 1.5 for usable segments (got ${seg.recommended_duration_s})`,
      });
    }
  });

export type SegmentV2 = z.infer<typeof SegmentV2Schema>;

// ── Pass 1 boundary pass ──

export const BoundariesPassItemSchema = z.object({
  start_s: z.number().min(0),
  end_s: z.number().min(0),
  segment_type: segmentTypeV2Schema,
  preliminary_notes: z.string().max(200),
});

export const BoundariesPassSchema = z.array(BoundariesPassItemSchema);

export type BoundariesPassItem = z.infer<typeof BoundariesPassItemSchema>;
export type BoundariesPass = z.infer<typeof BoundariesPassSchema>;
