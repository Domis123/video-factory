/**
 * Coherence Critic (W6) — pre-render storyboard review.
 *
 * `reviewStoryboard` consumes a finished storyboard (Planner output + W5 picks
 * + brand persona), computes mechanical signals as prompt observations, ships
 * a text-only Gemini call (gemini-3.1-pro-preview, @google/genai), and returns
 * a validated `CriticVerdict` with `approve | revise | reject`.
 *
 * The per-slot Director saw one slot at a time. The Critic sees the full board
 * — catches duplications, subject-continuity breaks, energy-arc issues,
 * narrative incoherence, duration mismatches, posture drift.
 *
 * Pre-compute hints are observations injected into the prompt, NOT silent
 * corrections. The model still renders final judgment; the hints just ensure
 * mechanically-detectable issues (duplicates, duration) don't get missed.
 *
 * Semantic validation enforces verdict consistency (no approve-with-high).
 * No silent corrections on validation failures — throw.
 *
 * Not yet wired. W8 orchestrator is first consumer; W9 shadows.
 *
 * File: src/agents/coherence-critic.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import {
  GeminiCriticResponseSchema,
  CriticVerdictSchema,
  type CriticVerdict,
  type GeminiCriticResponse,
} from '../types/critic-verdict.js';
import type { PlannerOutput, PlannerSlot } from '../types/planner-output.js';
import type { StoryboardPicks, SlotPick } from '../types/slot-pick.js';
import type { BrandPersona } from '../types/brand-persona.js';

const CRITIC_MODEL = process.env['GEMINI_CRITIC_MODEL'] || 'gemini-3.1-pro-preview';
const TEMPERATURE = 0.3;

// Platform duration floor/ceiling — used for `duration_mismatch` pre-compute.
// Soft floor (8s) + soft ceiling (32s); hard platform constraints can be
// tuned later without re-shipping the prompt.
const DURATION_FLOOR_S = 8;
const DURATION_CEILING_S = 32;

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, './prompts/coherence-critic.md'),
  'utf-8',
);

// Apply the W3/W5 stripSchemaBounds learning: Gemini's responseSchema validator
// rejects dense enum + bounds combinations. Strip bounds pre-submission; Zod
// still enforces them on the returned JSON.
const RAW_CRITIC_JSON_SCHEMA = zodToJsonSchema(GeminiCriticResponseSchema, {
  target: 'openApi3',
  $refStrategy: 'none',
});

const BOUND_KEYS_TO_STRIP = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]);

function stripSchemaBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchemaBounds);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (BOUND_KEYS_TO_STRIP.has(k)) continue;
      out[k] = stripSchemaBounds(v);
    }
    return out;
  }
  return node;
}

const CRITIC_JSON_SCHEMA = stripSchemaBounds(RAW_CRITIC_JSON_SCHEMA) as Record<
  string,
  unknown
>;

// ─────────────────────────────────────────────────────────────────────────────
// Public types + entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateMetadataSnapshot {
  segment_id: string;
  parent_asset_id: string;
  segment_type: string;
  duration_s: number;
  body_regions: string[];
  form_rating: string;
  quality_overall: number | null;
  on_screen_text: string | null;
  description: string;
  subject_primary_hair_color: string | null;
  subject_primary_top_color: string | null;
}

export interface ReviewStoryboardInput {
  plannerOutput: PlannerOutput;
  picks: StoryboardPicks;
  brandPersona: BrandPersona;
  // Optional: pre-fetched snapshots (e.g., synthetic tests). When omitted, the
  // wrapper queries Supabase for the picked segment_ids' segment_v2 JSONB.
  candidateSnapshots?: CandidateMetadataSnapshot[];
}

export async function reviewStoryboard(
  input: ReviewStoryboardInput,
): Promise<CriticVerdict> {
  const { plannerOutput, picks, brandPersona } = input;

  if (picks.picks.length !== plannerOutput.slots.length) {
    throw new Error(
      `[coherence-critic] picks length ${picks.picks.length} !== slots length ${plannerOutput.slots.length}`,
    );
  }

  const t0 = Date.now();

  // 1. Load candidate snapshots (one Supabase query unless caller pre-fetched).
  const snapshots =
    input.candidateSnapshots ??
    (await fetchSnapshots(picks.picks.map((p) => p.picked_segment_id)));

  // 2. Compute mechanical pre-compute signals → prompt observations.
  const precompute = computePrecompute(plannerOutput, picks);

  // 3. Build prompt + call Gemini (text-only).
  const prompt = renderPrompt(
    plannerOutput,
    picks,
    brandPersona,
    snapshots,
    precompute,
  );
  const response = await callGemini(prompt);

  // 4. Semantic validation — throws on self-contradiction.
  validateVerdict(response, plannerOutput);

  const latency_ms = Date.now() - t0;
  return CriticVerdictSchema.parse({
    verdict: response.verdict,
    overall_reasoning: response.overall_reasoning,
    issues: response.issues,
    latency_ms,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot fetch
// ─────────────────────────────────────────────────────────────────────────────

interface SegmentRowForSnapshot {
  id: string;
  parent_asset_id: string;
  segment_type: string | null;
  start_s: number | null;
  end_s: number | null;
  description: string | null;
  segment_v2: unknown;
}

export async function fetchSnapshots(
  segmentIds: string[],
): Promise<CandidateMetadataSnapshot[]> {
  if (segmentIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, segment_type, start_s, end_s, description, segment_v2')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`[coherence-critic] snapshot fetch failed: ${error.message}`);
  }
  const rows = (data ?? []) as SegmentRowForSnapshot[];
  // Preserve input order — the Critic prompt indexes picks by slot order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return segmentIds.map((id) => {
    const r = byId.get(id);
    if (!r) {
      throw new Error(
        `[coherence-critic] snapshot fetch: segment_id ${id} not found in asset_segments`,
      );
    }
    return rowToSnapshot(r);
  });
}

function rowToSnapshot(r: SegmentRowForSnapshot): CandidateMetadataSnapshot {
  const v2 = (r.segment_v2 ?? {}) as Record<string, unknown>;
  const exercise = (v2['exercise'] ?? {}) as Record<string, unknown>;
  const subject = (v2['subject'] ?? {}) as Record<string, unknown>;
  const subjectPrimary = (subject['primary'] ?? {}) as Record<string, unknown>;
  const quality = (v2['quality'] ?? {}) as Record<string, unknown>;
  const audio = (v2['audio'] ?? {}) as Record<string, unknown>;

  const bodyRegions = Array.isArray(exercise['body_regions'])
    ? (exercise['body_regions'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const duration =
    r.start_s != null && r.end_s != null ? Math.max(0, r.end_s - r.start_s) : 0;

  return {
    segment_id: r.id,
    parent_asset_id: r.parent_asset_id,
    segment_type: r.segment_type ?? 'unknown',
    duration_s: +duration.toFixed(2),
    body_regions: bodyRegions,
    form_rating: typeof exercise['form_rating'] === 'string' ? (exercise['form_rating'] as string) : 'n/a',
    quality_overall:
      typeof quality['overall'] === 'number' ? (quality['overall'] as number) : null,
    on_screen_text:
      typeof audio['on_screen_text'] === 'string'
        ? (audio['on_screen_text'] as string)
        : null,
    description: r.description ?? '',
    subject_primary_hair_color:
      typeof subjectPrimary['hair_color'] === 'string'
        ? (subjectPrimary['hair_color'] as string)
        : null,
    subject_primary_top_color:
      typeof subjectPrimary['top_color'] === 'string'
        ? (subjectPrimary['top_color'] as string)
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-compute (mechanical signals injected into prompt)
// ─────────────────────────────────────────────────────────────────────────────

interface PrecomputeSignals {
  duplicate_segment_ids: string[];
  parent_distribution: Array<{ parent_asset_id: string; slot_indices: number[] }>;
  total_duration_s: number;
  duration_status: 'under_floor' | 'over_ceiling' | 'ok';
  energy_sequence: number[];
  primary_parent_sequence: Array<{ slot_index: number; parent_asset_id: string }>;
}

function computePrecompute(
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
): PrecomputeSignals {
  // Duplicate segment_ids
  const segCounts = new Map<string, number>();
  for (const p of picks.picks) {
    segCounts.set(p.picked_segment_id, (segCounts.get(p.picked_segment_id) ?? 0) + 1);
  }
  const duplicates = [...segCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);

  // Parent distribution
  const parentMap = new Map<string, number[]>();
  for (const p of picks.picks) {
    const arr = parentMap.get(p.parent_asset_id) ?? [];
    arr.push(p.slot_index);
    parentMap.set(p.parent_asset_id, arr);
  }
  const parentDist = [...parentMap.entries()].map(([parent_asset_id, slot_indices]) => ({
    parent_asset_id,
    slot_indices: slot_indices.sort((a, b) => a - b),
  }));

  // Total duration
  const total = picks.picks.reduce((a, p) => a + (p.out_point_s - p.in_point_s), 0);
  const rounded = +total.toFixed(2);
  const status: PrecomputeSignals['duration_status'] =
    rounded < DURATION_FLOOR_S
      ? 'under_floor'
      : rounded > DURATION_CEILING_S
      ? 'over_ceiling'
      : 'ok';

  // Energy sequence (by slot array position — matches prompt's per-slot block order)
  const energySeq = plannerOutput.slots.map((s) => s.energy);

  // Primary parent sequence — only primary slots, in slot-index order.
  const primaryParents: Array<{ slot_index: number; parent_asset_id: string }> = [];
  for (const s of plannerOutput.slots) {
    if (s.subject_role !== 'primary') continue;
    const pick = picks.picks.find((p) => p.slot_index === s.slot_index);
    if (pick) {
      primaryParents.push({
        slot_index: s.slot_index,
        parent_asset_id: pick.parent_asset_id,
      });
    }
  }

  return {
    duplicate_segment_ids: duplicates,
    parent_distribution: parentDist,
    total_duration_s: rounded,
    duration_status: status,
    energy_sequence: energySeq,
    primary_parent_sequence: primaryParents,
  };
}

function formatPrecomputeForPrompt(p: PrecomputeSignals): string {
  const lines: string[] = [];
  lines.push('```');
  if (p.duplicate_segment_ids.length > 0) {
    lines.push(
      `duplicate_segment_ids: ${p.duplicate_segment_ids.join(', ')}  ← MUST flag as duplicate_segment_across_slots (severity: high)`,
    );
  } else {
    lines.push('duplicate_segment_ids: (none)');
  }
  lines.push(
    `total_duration_s: ${p.total_duration_s}  (floor=${DURATION_FLOOR_S}, ceiling=${DURATION_CEILING_S}, status=${p.duration_status})`,
  );
  if (p.duration_status !== 'ok') {
    lines.push(
      `  ← MUST flag as duration_mismatch (severity: high) — ${
        p.duration_status === 'under_floor'
          ? `total ${p.total_duration_s}s < ${DURATION_FLOOR_S}s floor`
          : `total ${p.total_duration_s}s > ${DURATION_CEILING_S}s ceiling`
      }`,
    );
  }
  lines.push(`energy_sequence: [${p.energy_sequence.join(', ')}]`);
  lines.push('parent_distribution:');
  for (const pd of p.parent_distribution) {
    lines.push(
      `  ${pd.parent_asset_id}  → slots [${pd.slot_indices.join(', ')}]`,
    );
  }
  lines.push('primary_parent_sequence:');
  if (p.primary_parent_sequence.length === 0) {
    lines.push('  (no primary slots)');
  } else {
    for (const pp of p.primary_parent_sequence) {
      lines.push(`  slot ${pp.slot_index}: parent=${pp.parent_asset_id}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderPrompt(
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
  persona: BrandPersona,
  snapshots: CandidateMetadataSnapshot[],
  precompute: PrecomputeSignals,
): string {
  const slotBlocks = renderSlotBlocks(plannerOutput.slots, picks.picks, snapshots);
  const allowedPostures = collectAllowedPostures(persona);
  const personaTenets = formatPersonaTenets(persona);

  return PROMPT_TEMPLATE.replace(
    '{precompute_observations}',
    formatPrecomputeForPrompt(precompute),
  )
    .replace('{form_id}', plannerOutput.form_id)
    .replace('{hook_mechanism}', plannerOutput.hook_mechanism)
    .replace('{posture}', plannerOutput.posture)
    .replace('{subject_consistency}', plannerOutput.subject_consistency)
    .replace('{slot_count}', String(plannerOutput.slot_count))
    .replace('{music_intent}', plannerOutput.music_intent)
    .replace('{creative_vision}', plannerOutput.creative_vision)
    .replace('{audience_framing}', plannerOutput.audience_framing ?? '(none)')
    .replace('{slot_blocks}', slotBlocks)
    .replace('{brand_id}', persona.brand_id)
    .replace('{audience_primary}', persona.audience.primary)
    .replace(
      '{allowed_color_treatments}',
      persona.allowed_color_treatments.join(', ') || '(none declared)',
    )
    .replace('{allowed_postures}', allowedPostures)
    .replace('{persona_tenets}', personaTenets);
}

function renderSlotBlocks(
  slots: PlannerSlot[],
  picks: SlotPick[],
  snapshots: CandidateMetadataSnapshot[],
): string {
  // picks and snapshots align by position (snapshot[i] corresponds to picks[i]
  // after the fetchSnapshots call, which preserved segmentId order). But the
  // picks array is already sorted by slot_index in StoryboardPicksSchema; the
  // slots array is in its own Planner order. Iterate slots; for each, find
  // the matching pick by slot_index, then find the snapshot by segment_id.
  const snapshotById = new Map(snapshots.map((s) => [s.segment_id, s]));
  const pickByIndex = new Map(picks.map((p) => [p.slot_index, p]));

  const blocks: string[] = [];
  for (const slot of slots) {
    const pick = pickByIndex.get(slot.slot_index);
    const snap = pick ? snapshotById.get(pick.picked_segment_id) : undefined;
    blocks.push(formatSlotBlock(slot, pick, snap));
  }
  return blocks.join('\n\n');
}

function formatSlotBlock(
  slot: PlannerSlot,
  pick: SlotPick | undefined,
  snap: CandidateMetadataSnapshot | undefined,
): string {
  const lines: string[] = [];
  lines.push(`### Slot ${slot.slot_index}  role=${slot.slot_role}  subject_role=${slot.subject_role}`);
  lines.push(`  target_duration_s:       ${slot.target_duration_s}`);
  lines.push(`  energy:                  ${slot.energy}`);
  lines.push(
    `  body_focus:              ${
      slot.body_focus ? JSON.stringify(slot.body_focus) : 'null'
    }`,
  );
  lines.push(
    `  segment_type_preferences: [${slot.segment_type_preferences.join(', ')}]`,
  );
  lines.push(`  narrative_beat:          ${slot.narrative_beat}`);
  if (!pick) {
    lines.push(`  PICK:                    (MISSING — no pick for this slot)`);
    return lines.join('\n');
  }
  lines.push(
    `  PICK segment_id:         ${pick.picked_segment_id}  parent=${pick.parent_asset_id}`,
  );
  lines.push(
    `  PICK in/out/duration:    ${pick.in_point_s.toFixed(2)} → ${pick.out_point_s.toFixed(2)}  (${pick.duration_s.toFixed(2)}s)`,
  );
  lines.push(`  PICK director_reasoning: ${pick.reasoning}`);
  if (snap) {
    lines.push(
      `  CLIP segment_type:       ${snap.segment_type}   body_regions: [${snap.body_regions.join(', ')}]`,
    );
    lines.push(
      `  CLIP form_rating:        ${snap.form_rating}   quality_overall: ${snap.quality_overall ?? 'n/a'}`,
    );
    lines.push(
      `  CLIP on_screen_text:     ${snap.on_screen_text ?? '(none)'}`,
    );
    if (snap.subject_primary_hair_color || snap.subject_primary_top_color) {
      lines.push(
        `  CLIP subject_primary:    hair=${snap.subject_primary_hair_color ?? 'n/a'}   top=${snap.subject_primary_top_color ?? 'n/a'}`,
      );
    }
    if (snap.description) {
      const oneLine = snap.description.replace(/\s+/g, ' ').trim().slice(0, 280);
      lines.push(`  CLIP description:        ${oneLine}`);
    }
  } else {
    lines.push(`  CLIP metadata:           (snapshot unavailable)`);
  }
  return lines.join('\n');
}

function collectAllowedPostures(persona: BrandPersona): string {
  const postures = new Set<string>();
  for (const arr of Object.values(persona.form_posture_allowlist)) {
    if (Array.isArray(arr)) for (const p of arr) postures.add(p);
  }
  return Array.from(postures).sort().join(', ') || '(none declared)';
}

function formatPersonaTenets(persona: BrandPersona): string {
  const lines = persona.prose_body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .slice(0, 8);
  return lines.length ? lines.map((l) => `- ${l}`).join('\n') : '(no prose tenets)';
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini call + parse retry
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<GeminiCriticResponse> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const maxParseAttempts = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
    try {
      const response = await withLLMRetry(
        () =>
          ai.models.generateContent({
            model: CRITIC_MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: CRITIC_JSON_SCHEMA as Record<string, unknown>,
              temperature: TEMPERATURE,
            },
          }),
        { label: `coherence-critic`, maxAttempts: 3 },
      );
      const text = response.text ?? '';
      if (!text) throw new Error('Gemini coherence-critic returned empty text');
      const raw = JSON.parse(text);
      return GeminiCriticResponseSchema.parse(raw);
    } catch (err) {
      lastErr = err;
      const isParseErr =
        err instanceof z.ZodError ||
        err instanceof SyntaxError ||
        (err instanceof Error && err.message.includes('returned empty text'));
      if (isParseErr && attempt < maxParseAttempts) {
        console.warn(
          `[coherence-critic] attempt ${attempt} parse failed, retrying: ${messageOf(err)}`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('coherence-critic exhausted retries without a final error');
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic validation (no silent corrections)
// ─────────────────────────────────────────────────────────────────────────────

function validateVerdict(
  response: GeminiCriticResponse,
  plannerOutput: PlannerOutput,
): void {
  // 1. slot indices referenced in issues must exist in the planner's slot set.
  const validSlotIndices = new Set(plannerOutput.slots.map((s) => s.slot_index));
  for (const issue of response.issues) {
    for (const idx of issue.affected_slot_indices) {
      if (!validSlotIndices.has(idx)) {
        throw new Error(
          `[coherence-critic] issue references unknown slot_index ${idx}; planner slots: [${[...validSlotIndices].join(', ')}]`,
        );
      }
    }
  }

  // 2. approve-with-high is self-contradiction.
  const hasHigh = response.issues.some((i) => i.severity === 'high');
  if (response.verdict === 'approve' && hasHigh) {
    const highList = response.issues
      .filter((i) => i.severity === 'high')
      .map((i) => `${i.issue_type}(slots=${i.affected_slot_indices.join(',')})`)
      .join(', ');
    throw new Error(
      `[coherence-critic] self-contradiction: verdict='approve' with high-severity issues: ${highList}`,
    );
  }

  // 3. approve-with-medium is also self-contradiction per prompt's decision guidance.
  const mediumCount = response.issues.filter((i) => i.severity === 'medium').length;
  if (response.verdict === 'approve' && mediumCount >= 2) {
    throw new Error(
      `[coherence-critic] self-contradiction: verdict='approve' with ${mediumCount} medium-severity issues (threshold: revise at ≥2 medium)`,
    );
  }

  // 4. 'other' issues must have a substantive note (Zod min(10) already, but
  //    reject vague boilerplate here as a safety net).
  for (const issue of response.issues) {
    if (issue.issue_type === 'other') {
      const note = issue.note.trim().toLowerCase();
      if (
        note === 'other' ||
        note === 'see description' ||
        note === 'no description'
      ) {
        throw new Error(
          `[coherence-critic] 'other' issue has insufficient note: "${issue.note}"`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// utils
// ─────────────────────────────────────────────────────────────────────────────

function messageOf(err: unknown): string {
  if (err == null) return 'unknown';
  if (err instanceof z.ZodError) {
    return err.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
