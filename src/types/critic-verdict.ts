/**
 * CriticVerdict — Coherence Critic's pre-render storyboard review (W6).
 *
 * Two Zod surfaces live here:
 *   1. `GeminiCriticResponseSchema` — minimal shape the model emits. Narrow so
 *      `stripSchemaBounds()` has less to strip and `responseSchema` has less to
 *      reject.
 *   2. `CriticVerdictSchema` — full record returned by the agent. Model output +
 *      wrapper-populated diagnostics (latency_ms).
 *
 * Issue taxonomy is a fixed enum so downstream orchestrator routing (W8) can
 * branch deterministically on issue_type. `'other'` is an escape hatch; its
 * `note` MUST describe the problem.
 *
 * File: src/types/critic-verdict.ts
 */

import { z } from 'zod';

export const ISSUE_TYPE_VALUES = [
  // W5 Gate A finding — same segment_id appears in 2+ picks.
  'duplicate_segment_across_slots',
  // Different segment_ids but same parent with overlapping timestamps.
  'near_duplicate_segment',
  // Primary slots pick different parents without narrative justification.
  'subject_discontinuity',
  // Storyboard's aesthetic drifts from brand persona's allowed postures.
  'posture_drift',
  // Slot energy sequence doesn't support the form_id's expected arc.
  'energy_arc_broken',
  // Narrative beats don't form a coherent story for form + hook_mechanism.
  'narrative_incoherence',
  // Total duration over ~32s or under ~8s (hard platform floor/ceiling).
  'duration_mismatch',
  // Hook slot fails to open the hook_mechanism effectively.
  'hook_weak',
  // Close slot doesn't close the beat (hangs, trails off).
  'close_weak',
  // Slot body_focus doesn't align with picked clip's body_regions.
  'body_focus_mismatch',
  // Picked clip's form_rating is beginner_modified or worse when slot needed excellence.
  'form_rating_low',
  // Narrative_beat implies text that the picked clip already has on-screen.
  'overlay_text_visual_collision',
  // Escape hatch — must be accompanied by a descriptive `note`.
  'other',
] as const;
export type IssueType = (typeof ISSUE_TYPE_VALUES)[number];

export const SEVERITY_VALUES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export const VERDICT_VALUES = ['approve', 'revise', 'reject'] as const;
export type Verdict = (typeof VERDICT_VALUES)[number];

export const CriticIssueSchema = z.object({
  issue_type: z.enum(ISSUE_TYPE_VALUES),
  severity: z.enum(SEVERITY_VALUES),
  affected_slot_indices: z.array(z.number().int().min(0)).min(1),
  note: z.string().min(10).max(300),
  suggested_fix: z.string().min(10).max(300).nullable(),
});

export type CriticIssue = z.infer<typeof CriticIssueSchema>;

// The minimal shape Gemini is asked to emit. No wrapper-populated fields.
export const GeminiCriticResponseSchema = z.object({
  verdict: z.enum(VERDICT_VALUES),
  overall_reasoning: z.string().min(20).max(500),
  issues: z.array(CriticIssueSchema),
});

export type GeminiCriticResponse = z.infer<typeof GeminiCriticResponseSchema>;

export const CriticVerdictSchema = z.object({
  verdict: z.enum(VERDICT_VALUES),
  overall_reasoning: z.string().min(20).max(500),
  issues: z.array(CriticIssueSchema),
  // Diagnostic — populated wrapper-side.
  latency_ms: z.number().int().nonnegative(),
});

export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;
