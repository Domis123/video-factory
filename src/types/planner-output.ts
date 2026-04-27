/**
 * PlannerOutput — the structural brief emitted by the Planner (W3).
 *
 * NOT the full context_packet. No overlay text (Copywriter @ W7),
 * no clip picks (Director @ W5), no voiceover_script (reserved for post-W10).
 *
 * File: src/types/planner-output.ts
 */

import { z } from 'zod';
import { FORM_ID_VALUES, POSTURE_VALUES } from './content-forms.js';

export const SEGMENT_TYPE_VALUES = [
  'setup',
  'exercise',
  'transition',
  'hold',
  'cooldown',
  'talking-head',
  'b-roll',
  'unusable',
] as const;
export type SegmentType = (typeof SEGMENT_TYPE_VALUES)[number];

export const HOOK_MECHANISM_VALUES = [
  'specific-pain-promise',
  'visual-pattern-interrupt',
  'opening-energy',
  'authority-claim',
  'confessional-vulnerability',
  'narrative-intrigue',
  'trend-recognition',
] as const;
export type HookMechanism = (typeof HOOK_MECHANISM_VALUES)[number];

export const MUSIC_INTENT_VALUES = [
  'calm-ambient',
  'upbeat-electronic',
  'motivational-cinematic',
  'warm-acoustic',
  'none',
] as const;
export type MusicIntent = (typeof MUSIC_INTENT_VALUES)[number];

export const SUBJECT_CONSISTENCY_VALUES = [
  'single-subject',
  'prefer-same',
  'mixed',
] as const;
export type SubjectConsistency = (typeof SUBJECT_CONSISTENCY_VALUES)[number];

export const SLOT_ROLE_VALUES = ['hook', 'body', 'close'] as const;
export type SlotRole = (typeof SLOT_ROLE_VALUES)[number];

export const SUBJECT_ROLE_VALUES = ['primary', 'any'] as const;
export type SubjectRole = (typeof SUBJECT_ROLE_VALUES)[number];

export const PlannerSlotSchema = z.object({
  slot_index: z.number().int().min(0),
  slot_role: z.enum(SLOT_ROLE_VALUES),
  // Gemini responseSchema rejects `exclusiveMinimum`, so we use `.min(0.1)`
  // (plain `minimum`) instead of `.positive()` to keep the schema acceptable.
  target_duration_s: z.number().min(0.1).max(15),
  energy: z.number().int().min(1).max(10),
  body_focus: z.array(z.string().min(1)).nullable(),
  segment_type_preferences: z.array(z.enum(SEGMENT_TYPE_VALUES)).min(1).max(4),
  subject_role: z.enum(SUBJECT_ROLE_VALUES),
  narrative_beat: z.string().min(10).max(200),
});

export const PlannerOutputSchema = z.object({
  creative_vision: z.string().min(20).max(200),
  form_id: z.enum(FORM_ID_VALUES),
  hook_mechanism: z.enum(HOOK_MECHANISM_VALUES),
  audience_framing: z.string().nullable(),
  subject_consistency: z.enum(SUBJECT_CONSISTENCY_VALUES),
  slot_count: z.number().int().min(1).max(12),
  slots: z.array(PlannerSlotSchema).min(1).max(12),
  music_intent: z.enum(MUSIC_INTENT_VALUES),
  posture: z.enum(POSTURE_VALUES),
  // W9.1 — wrapper attaches the computed Gemini cost after parse. Default 0
  // keeps old fixtures parsing cleanly; the model's emit may include or omit
  // the field — either way the wrapper overrides post-parse.
  cost_usd: z.number().min(0).default(0),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type PlannerSlot = z.infer<typeof PlannerSlotSchema>;
