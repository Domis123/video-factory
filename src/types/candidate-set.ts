/**
 * CandidateSet — the typed response payload from `match_segments_v2` RPC.
 *
 * Shape is what W5 Visual Director consumes: per-slot top-N candidate segments
 * with the v2 metadata it reasons over plus diagnostic signals it can log
 * (similarity, boost_score, relaxation_applied).
 *
 * File: src/types/candidate-set.ts
 */

import { z } from 'zod';
import { SLOT_ROLE_VALUES } from './planner-output.js';

export const RELAXATION_TOKEN_VALUES = [
  'segment_type',
  'body_focus',
  'editorial_suitability',
  'duration',
] as const;
export type RelaxationToken = (typeof RELAXATION_TOKEN_VALUES)[number];

export const EDITORIAL_SUITABILITY_VALUES = [
  'excellent',
  'good',
  'poor',
  'unsuitable',
] as const;
export type EditorialSuitability = (typeof EDITORIAL_SUITABILITY_VALUES)[number];

export const CandidateSchema = z.object({
  segment_id: z.string().uuid(),
  parent_asset_id: z.string().uuid(),
  similarity: z.number(),
  segment_type: z.string().min(1),
  start_s: z.number().min(0),
  end_s: z.number().min(0),
  clip_r2_key: z.string().nullable(),
  keyframe_grid_r2_key: z.string().nullable(),
  description: z.string().nullable(),
  segment_v2: z.unknown().nullable(),
  matched_body_regions: z.array(z.string()),
  editorial_suitability_for_role: z.enum(EDITORIAL_SUITABILITY_VALUES),
  boost_score: z.number(),
  relaxation_applied: z.array(z.enum(RELAXATION_TOKEN_VALUES)),
});

export type Candidate = z.infer<typeof CandidateSchema>;

export const RelaxationSummarySchema = z.object({
  total_candidates: z.number().int().min(0),
  strict_match_count: z.number().int().min(0),
  relaxations_used: z.array(z.enum(RELAXATION_TOKEN_VALUES)),
});

export type RelaxationSummary = z.infer<typeof RelaxationSummarySchema>;

export const CandidateSetSchema = z.object({
  slot_index: z.number().int().min(0),
  slot_role: z.enum(SLOT_ROLE_VALUES),
  candidates: z.array(CandidateSchema),
  relaxation_summary: RelaxationSummarySchema,
  latency_ms: z.number().int().min(0),
});

export type CandidateSet = z.infer<typeof CandidateSetSchema>;
