/**
 * candidate-retrieval-v2 — TypeScript wrapper around the `match_segments_v2` RPC
 * (migration 010). Consumes a W3 `PlannerSlot` + a 512-dim CLIP query embedding
 * and returns a Zod-validated `CandidateSet` for the W5 Visual Director.
 *
 * W4 only. No worker wiring yet; W5 Director is first consumer.
 *
 * Naming note: the Phase 3.5 production tree already has `curator-v2-retrieval.ts`
 * (v1 RPC caller). This file is the v2 sibling, named per the W4 brief's naming-
 * conflict guard.
 *
 * File: src/agents/candidate-retrieval-v2.ts
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { PlannerSlot } from '../types/planner-output.js';
import {
  CandidateSchema,
  CandidateSetSchema,
  RELAXATION_TOKEN_VALUES,
  type Candidate,
  type CandidateSet,
  type RelaxationToken,
} from '../types/candidate-set.js';

export interface CandidateRetrievalInput {
  slot: PlannerSlot;
  queryEmbedding: number[];
  brandId: string;
  subjectHintParentAssetId?: string | null;
  targetCount?: number;
  durationToleranceS?: number;
  minFormRating?: 'beginner_modified' | 'excellent_controlled';
  minQualityOverall?: number;
  candidateMultiplier?: number;
}

const TARGET_COUNT_MIN = 5;
const TARGET_COUNT_MAX = 30;
const TARGET_COUNT_DEFAULT = 18;
const EMBED_DIM = 512;

function clampTargetCount(requested: number | undefined): number {
  if (requested === undefined) return TARGET_COUNT_DEFAULT;
  if (!Number.isFinite(requested)) return TARGET_COUNT_DEFAULT;
  const n = Math.trunc(requested);
  if (n < TARGET_COUNT_MIN) {
    console.warn(
      `[candidate-retrieval-v2] targetCount=${requested} below min ${TARGET_COUNT_MIN}; clamping.`,
    );
    return TARGET_COUNT_MIN;
  }
  if (n > TARGET_COUNT_MAX) {
    console.warn(
      `[candidate-retrieval-v2] targetCount=${requested} above max ${TARGET_COUNT_MAX}; clamping.`,
    );
    return TARGET_COUNT_MAX;
  }
  return n;
}

function serializeEmbedding(vec: number[]): string {
  if (vec.length !== EMBED_DIM) {
    throw new Error(
      `[candidate-retrieval-v2] embedding must be ${EMBED_DIM}-dim; got ${vec.length}`,
    );
  }
  // pgvector TEXT literal: "[v1,v2,...]"
  return `[${vec.join(',')}]`;
}

export async function retrieveCandidates(
  input: CandidateRetrievalInput,
): Promise<CandidateSet> {
  const { slot, queryEmbedding, brandId } = input;
  if (!brandId || !brandId.trim()) {
    throw new Error('retrieveCandidates: brandId is required');
  }

  const targetCount = clampTargetCount(input.targetCount);
  const embeddingLiteral = serializeEmbedding(queryEmbedding);

  const rpcParams = {
    query_embedding: embeddingLiteral,
    brand_filter: brandId,
    segment_type_preferences: slot.segment_type_preferences,
    body_focus_tokens: slot.body_focus, // may be null
    slot_role: slot.slot_role,
    target_duration_s: slot.target_duration_s,
    duration_tolerance_s: input.durationToleranceS ?? 2.0,
    subject_hint_parent_asset_id: input.subjectHintParentAssetId ?? null,
    min_form_rating: input.minFormRating ?? 'beginner_modified',
    min_quality_overall: input.minQualityOverall ?? 5,
    target_count: targetCount,
    candidate_multiplier: input.candidateMultiplier ?? 3,
  };

  const t0 = Date.now();
  const { data, error } = await supabaseAdmin.rpc('match_segments_v2', rpcParams);
  const latency_ms = Date.now() - t0;

  if (error) {
    throw new Error(
      `[candidate-retrieval-v2] RPC match_segments_v2 failed: ${error.message}`,
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const candidates: Candidate[] = rows.map((row: unknown) => CandidateSchema.parse(row));

  const strict_match_count = candidates.filter(
    (c) => c.relaxation_applied.length === 0,
  ).length;
  const relaxationsSet = new Set<RelaxationToken>();
  for (const c of candidates) {
    for (const t of c.relaxation_applied) relaxationsSet.add(t);
  }
  const relaxations_used = RELAXATION_TOKEN_VALUES.filter((t) => relaxationsSet.has(t));

  const result: CandidateSet = {
    slot_index: slot.slot_index,
    slot_role: slot.slot_role,
    candidates,
    relaxation_summary: {
      total_candidates: candidates.length,
      strict_match_count,
      relaxations_used,
    },
    latency_ms,
  };

  return CandidateSetSchema.parse(result);
}
