/**
 * Visual Director (W5) — multimodal clip picker.
 *
 * Per-slot primitive: `pickClipForSlot` consumes a planner slot + its W4
 * CandidateSet, fetches each candidate's keyframe grid, ships a multimodal
 * Gemini call (gemini-3.1-pro-preview, @google/genai), returns a validated
 * SlotPick.
 *
 * Multi-slot orchestrator: `pickClipsForStoryboard` fans out non-primary slots
 * via Promise.all; chains primary slots sequentially so each primary pick can
 * hint the next. Trusts W4's boost-scored pool for diversity — no cross-slot
 * coordination. Reports parallel_speedup_ratio for observability.
 *
 * Not yet wired to any worker. W8 orchestrator is first consumer; W9 shadows.
 *
 * File: src/agents/visual-director.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { env } from '../config/env.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import { computeGeminiCost } from '../lib/llm-cost.js';
import { fetchKeyframeGrid } from '../lib/r2-fetch.js';
import {
  GeminiPickResponseSchema,
  SlotPickSchema,
  StoryboardPicksSchema,
  type GeminiPickResponse,
  type SlotPick,
  type StoryboardPicks,
} from '../types/slot-pick.js';
import type { Candidate, CandidateSet } from '../types/candidate-set.js';
import type { PlannerOutput, PlannerSlot } from '../types/planner-output.js';
import type { BrandPersona } from '../types/brand-persona.js';

const DIRECTOR_MODEL = process.env['GEMINI_DIRECTOR_MODEL'] || 'gemini-3.1-pro-preview';
const TEMPERATURE = 0.4;

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, './prompts/visual-director.md'),
  'utf-8',
);

// Apply the W3 stripSchemaBounds learning: Gemini's responseSchema validator
// rejects dense enum + bounds combinations with an unhelpful INVALID_ARGUMENT
// 400. Strip bounds pre-submission; Zod still enforces them post-generation,
// and the narrow GeminiPickResponseSchema means any violation is cheap to retry.
const RAW_PICK_JSON_SCHEMA = zodToJsonSchema(GeminiPickResponseSchema, {
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

const PICK_JSON_SCHEMA = stripSchemaBounds(RAW_PICK_JSON_SCHEMA) as Record<
  string,
  unknown
>;

export interface PickClipForSlotInput {
  slot: PlannerSlot;
  candidateSet: CandidateSet;
  brandPersona: BrandPersona;
  priorPrimaryParentId?: string | null;
}

export async function pickClipForSlot(
  input: PickClipForSlotInput,
): Promise<SlotPick> {
  const { slot, candidateSet, brandPersona } = input;
  const priorPrimary = input.priorPrimaryParentId ?? null;

  if (!candidateSet.candidates.length) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: empty candidate pool (W4 relaxation should have prevented this)`,
    );
  }

  const t0 = Date.now();

  // 1. Fetch grids in parallel. Skip candidates missing keyframe_grid_r2_key.
  const withGrids = await fetchAllGrids(candidateSet.candidates, slot.slot_index);
  if (withGrids.length === 0) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: no candidates had keyframe_grid_r2_key; W1 backfill incomplete`,
    );
  }

  // 2. Build prompt + parts array.
  const prompt = renderPrompt(slot, withGrids, brandPersona, priorPrimary);
  const parts = buildParts(prompt, withGrids);

  // 3. Gemini call, Zod-parse, 2-attempt retry on parse failure only.
  const { picked, cost_usd } = await callGemini(parts, slot.slot_index);

  // 4. Semantic validation — throws on confabulated segment_id or bounds.
  const matchedCandidate = validatePick(picked, withGrids, slot);

  // 5. Subject-continuity warning (soft — log + append to reasoning).
  let reasoning = picked.reasoning;
  if (
    slot.subject_role === 'primary' &&
    priorPrimary &&
    matchedCandidate.parent_asset_id !== priorPrimary
  ) {
    const warn = ` [WARN: cross-parent pick on primary slot; prior primary parent was ${priorPrimary.slice(0, 8)}]`;
    console.warn(
      `[visual-director] slot_index=${slot.slot_index} cross-parent primary pick: prior=${priorPrimary.slice(0, 8)} now=${matchedCandidate.parent_asset_id.slice(0, 8)}`,
    );
    // Keep reasoning under the schema's 500-char cap.
    if ((reasoning + warn).length <= 500) reasoning = reasoning + warn;
  }

  const latency_ms = Date.now() - t0;

  const samePrimary: boolean | null =
    slot.subject_role === 'primary' && priorPrimary
      ? matchedCandidate.parent_asset_id === priorPrimary
      : null;

  return SlotPickSchema.parse({
    slot_index: slot.slot_index,
    picked_segment_id: matchedCandidate.segment_id,
    parent_asset_id: matchedCandidate.parent_asset_id,
    in_point_s: picked.in_point_s,
    out_point_s: picked.out_point_s,
    duration_s: +(picked.out_point_s - picked.in_point_s).toFixed(3),
    reasoning,
    similarity: matchedCandidate.boost_score,
    was_relaxed_match: matchedCandidate.relaxation_applied.length > 0,
    same_parent_as_primary: samePrimary,
    latency_ms,
    cost_usd,
  });
}

export interface PickClipsForStoryboardInput {
  plannerOutput: PlannerOutput;
  candidateSets: CandidateSet[];
  brandPersona: BrandPersona;
}

export async function pickClipsForStoryboard(
  input: PickClipsForStoryboardInput,
): Promise<StoryboardPicks> {
  const { plannerOutput, candidateSets, brandPersona } = input;
  if (candidateSets.length !== plannerOutput.slots.length) {
    throw new Error(
      `[visual-director] candidateSets length ${candidateSets.length} !== plannerOutput.slots length ${plannerOutput.slots.length}`,
    );
  }

  const wallStart = Date.now();

  // PlannerSlot.slot_index is identifier semantics — it can be non-contiguous
  // (the schema permits any non-negative int). Always iterate by array position
  // and treat candidateSets[pos] as the candidate set for plannerOutput.slots[pos].
  const primaryPositions: number[] = [];
  const nonPrimaryPositions: number[] = [];
  for (let pos = 0; pos < plannerOutput.slots.length; pos++) {
    if (plannerOutput.slots[pos].subject_role === 'primary') primaryPositions.push(pos);
    else nonPrimaryPositions.push(pos);
  }

  // Non-primary: no inter-slot dependency, run all in parallel.
  const nonPrimaryPicks = await Promise.all(
    nonPrimaryPositions.map((pos) =>
      pickClipForSlot({
        slot: plannerOutput.slots[pos],
        candidateSet: candidateSets[pos],
        brandPersona,
        priorPrimaryParentId: null,
      }),
    ),
  );

  // Primary: sequential chain so each pick hints the next.
  let priorPrimaryParentId: string | null = null;
  const primaryPicks: SlotPick[] = [];
  for (const pos of primaryPositions) {
    const pick = await pickClipForSlot({
      slot: plannerOutput.slots[pos],
      candidateSet: candidateSets[pos],
      brandPersona,
      priorPrimaryParentId,
    });
    primaryPicks.push(pick);
    priorPrimaryParentId = pick.parent_asset_id;
  }

  const allPicks = [...nonPrimaryPicks, ...primaryPicks].sort(
    (a, b) => a.slot_index - b.slot_index,
  );

  const total_latency_ms = Date.now() - wallStart;
  const perSlotSum = allPicks.reduce((a, p) => a + p.latency_ms, 0);
  // parallel_speedup_ratio > 1.0 means parallelism helped; = 1.0 means pure sequential.
  const parallel_speedup_ratio =
    total_latency_ms > 0 ? +(perSlotSum / total_latency_ms).toFixed(3) : 0;

  // W9.1 — aggregate per-slot costs into the storyboard total. Each slot's
  // cost was computed wrapper-side from that slot's Gemini call usageMetadata.
  const cost_usd = +allPicks.reduce((a, p) => a + p.cost_usd, 0).toFixed(6);

  return StoryboardPicksSchema.parse({
    picks: allPicks,
    total_latency_ms,
    parallel_speedup_ratio,
    cost_usd,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CandidateWithGrid {
  candidate: Candidate;
  grid: Buffer;
  displayIndex: number;
}

async function fetchAllGrids(
  candidates: Candidate[],
  slotIndex: number,
): Promise<CandidateWithGrid[]> {
  const eligible = candidates.filter((c) => !!c.keyframe_grid_r2_key);
  const skipped = candidates.length - eligible.length;
  if (skipped > 0) {
    console.warn(
      `[visual-director] slot_index=${slotIndex}: skipping ${skipped} candidate(s) missing keyframe_grid_r2_key`,
    );
  }

  const fetched = await Promise.all(
    eligible.map(async (c, i) => {
      try {
        const grid = await fetchKeyframeGrid(c.keyframe_grid_r2_key!);
        return { candidate: c, grid, displayIndex: i + 1 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[visual-director] slot_index=${slotIndex}: grid fetch failed for segment ${c.segment_id}: ${msg}`,
        );
        return null;
      }
    }),
  );

  // Re-index display numbers contiguously after drops.
  const kept = fetched.filter((x): x is CandidateWithGrid => x !== null);
  kept.forEach((x, i) => {
    x.displayIndex = i + 1;
  });
  return kept;
}

function renderPrompt(
  slot: PlannerSlot,
  withGrids: CandidateWithGrid[],
  persona: BrandPersona,
  priorPrimary: string | null,
): string {
  const candidateList = withGrids.map((x) => formatCandidate(x, priorPrimary)).join('\n\n');

  const priorPrimaryBlock = priorPrimary
    ? `**Prior primary parent:** ${priorPrimary}. Candidates from this parent are flagged [SAME-PARENT-AS-PRIMARY]. Prefer them for subject continuity, unless a cross-parent candidate is materially stronger and you can explain why.`
    : slot.subject_role === 'primary'
    ? '**Prior primary parent:** none yet — this is the first primary slot. No continuity hint to follow.'
    : '**Subject role:** any — continuity is not a concern for this slot.';

  return PROMPT_TEMPLATE.replace('{slot_index}', String(slot.slot_index))
    .replace('{slot_role}', slot.slot_role)
    .replace('{target_duration_s}', slot.target_duration_s.toString())
    .replace('{energy}', String(slot.energy))
    .replace(
      '{body_focus}',
      slot.body_focus ? JSON.stringify(slot.body_focus) : 'null',
    )
    .replace('{subject_role}', slot.subject_role)
    .replace('{narrative_beat}', slot.narrative_beat)
    .replace('{posture}', inferPersonaPosture(persona))
    .replace('{persona_tenets}', formatPersonaTenets(persona))
    .replace('{prior_primary_block}', priorPrimaryBlock)
    .replace('{candidate_list}', candidateList);
}

function formatCandidate(x: CandidateWithGrid, priorPrimary: string | null): string {
  const c = x.candidate;
  const flags: string[] = [];
  if (c.relaxation_applied.length > 0) {
    flags.push(`[RELAXED MATCH: ${c.relaxation_applied.join(', ')}]`);
  }
  if (priorPrimary && c.parent_asset_id === priorPrimary) {
    flags.push('[SAME-PARENT-AS-PRIMARY]');
  }

  const editorial = extractEditorial(c.segment_v2);
  const exercise = extractExercise(c.segment_v2);
  const quality = extractQuality(c.segment_v2);

  const bestIn = editorial.best_in_point_s ?? c.start_s;
  const bestOut = editorial.best_out_point_s ?? c.end_s;
  const duration = +(c.end_s - c.start_s).toFixed(2);

  const lines: string[] = [];
  lines.push(
    `[${x.displayIndex}] segment_id: ${c.segment_id}${flags.length ? '  ' + flags.join(' ') : ''}`,
  );
  lines.push(
    `    bounds:           start_s=${c.start_s.toFixed(2)}, end_s=${c.end_s.toFixed(2)}, duration=${duration.toFixed(2)}s`,
  );
  lines.push(
    `    best_in/out:      best_in_point_s=${bestIn.toFixed(2)}, best_out_point_s=${bestOut.toFixed(2)}`,
  );
  lines.push(
    `    segment_type:     ${c.segment_type}   body_regions: ${
      c.matched_body_regions.length ? JSON.stringify(c.matched_body_regions) : '[]'
    }`,
  );
  lines.push(
    `    quality:          ${quality !== null ? quality.toFixed(0) : 'unknown'}/10   form_rating: ${
      exercise.form_rating ?? 'n/a'
    }   editorial_suit: ${c.editorial_suitability_for_role}`,
  );
  if (c.description && c.description.trim()) {
    const oneLine = c.description.replace(/\s+/g, ' ').trim().slice(0, 240);
    lines.push(`    description:      ${oneLine}`);
  }
  lines.push(`    (see image #${x.displayIndex} below)`);
  return lines.join('\n');
}

function buildParts(
  prompt: string,
  withGrids: CandidateWithGrid[],
): Array<
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
> {
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [];
  // Text last per Rule 35 best practice: video-style inputs first, then text.
  for (const x of withGrids) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: x.grid.toString('base64'),
      },
    });
  }
  parts.push({ text: prompt });
  return parts;
}

async function callGemini(
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  >,
  slotIndex: number,
): Promise<{ picked: GeminiPickResponse; cost_usd: number }> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const maxParseAttempts = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
    try {
      const response = await withLLMRetry(
        () =>
          ai.models.generateContent({
            model: DIRECTOR_MODEL,
            contents: [{ role: 'user', parts }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: PICK_JSON_SCHEMA as Record<string, unknown>,
              temperature: TEMPERATURE,
            },
          }),
        { label: `visual-director slot_index=${slotIndex}`, maxAttempts: 3 },
      );

      const text = response.text ?? '';
      if (!text) throw new Error('Gemini visual-director returned empty text');
      const raw = JSON.parse(text);
      const picked = GeminiPickResponseSchema.parse(raw);
      // W9.1 — only the successful attempt's cost is charged. Parse-retry
      // attempts that threw before reaching here have their tokens sunk
      // (Gemini billed them but they're not surfaced through this path).
      const usage = computeGeminiCost(DIRECTOR_MODEL, response);
      return { picked, cost_usd: usage.cost_usd };
    } catch (err) {
      lastErr = err;
      // Empty-text is a transient multimodal flake — retry inside the same
      // parse-retry budget as Zod/SyntaxError. Not promoted to withLLMRetry
      // because its retry conditions are HTTP-status-oriented.
      const isParseErr =
        err instanceof z.ZodError ||
        err instanceof SyntaxError ||
        (err instanceof Error && err.message.includes('returned empty text'));
      if (isParseErr && attempt < maxParseAttempts) {
        console.warn(
          `[visual-director] slot_index=${slotIndex} attempt ${attempt} parse failed, retrying: ${messageOf(err)}`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('visual-director exhausted retries without a final error');
}

function validatePick(
  picked: GeminiPickResponse,
  withGrids: CandidateWithGrid[],
  slot: PlannerSlot,
): Candidate {
  const matched = withGrids.find(
    (x) => x.candidate.segment_id === picked.picked_segment_id,
  );
  if (!matched) {
    const shown = withGrids.map((x) => x.candidate.segment_id).join(', ');
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: picked_segment_id=${picked.picked_segment_id} was not in the candidate pool shown to the model. Shown: [${shown}]`,
    );
  }
  const c = matched.candidate;
  if (picked.in_point_s < c.start_s - 1e-6) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: in_point_s=${picked.in_point_s} < segment.start_s=${c.start_s}`,
    );
  }
  if (picked.out_point_s > c.end_s + 1e-6) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: out_point_s=${picked.out_point_s} > segment.end_s=${c.end_s}`,
    );
  }
  if (picked.out_point_s <= picked.in_point_s) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: out_point_s=${picked.out_point_s} <= in_point_s=${picked.in_point_s}`,
    );
  }
  if (picked.out_point_s - picked.in_point_s < 1.0 - 1e-6) {
    throw new Error(
      `[visual-director] slot_index=${slot.slot_index}: trim duration ${(picked.out_point_s - picked.in_point_s).toFixed(3)}s < 1.0s floor`,
    );
  }
  return c;
}

// ── segment_v2 extraction — defensive, v2 may be missing/partial on older rows ──

interface EditorialExtract {
  best_in_point_s: number | null;
  best_out_point_s: number | null;
}

function extractEditorial(v2: unknown): EditorialExtract {
  if (!v2 || typeof v2 !== 'object') {
    return { best_in_point_s: null, best_out_point_s: null };
  }
  const ed = (v2 as Record<string, unknown>)['editorial'];
  if (!ed || typeof ed !== 'object') {
    return { best_in_point_s: null, best_out_point_s: null };
  }
  const e = ed as Record<string, unknown>;
  const bin = typeof e['best_in_point_s'] === 'number' ? (e['best_in_point_s'] as number) : null;
  const bout =
    typeof e['best_out_point_s'] === 'number' ? (e['best_out_point_s'] as number) : null;
  return { best_in_point_s: bin, best_out_point_s: bout };
}

function extractExercise(v2: unknown): { form_rating: string | null } {
  if (!v2 || typeof v2 !== 'object') return { form_rating: null };
  const ex = (v2 as Record<string, unknown>)['exercise'];
  if (!ex || typeof ex !== 'object') return { form_rating: null };
  const fr = (ex as Record<string, unknown>)['form_rating'];
  return { form_rating: typeof fr === 'string' ? fr : null };
}

function extractQuality(v2: unknown): number | null {
  if (!v2 || typeof v2 !== 'object') return null;
  const q = (v2 as Record<string, unknown>)['quality'];
  if (!q || typeof q !== 'object') return null;
  const overall = (q as Record<string, unknown>)['overall'];
  return typeof overall === 'number' ? overall : null;
}

function inferPersonaPosture(persona: BrandPersona): string {
  // Persona's form_posture_allowlist gives the allowed postures per form; the
  // Director doesn't pick posture — it's already committed in plannerOutput.
  // For prompt context we surface the brand's posture vocabulary so the model
  // understands which tonal register to lean toward. Concatenate distinct
  // postures from the allowlist.
  const postures = new Set<string>();
  for (const arr of Object.values(persona.form_posture_allowlist)) {
    if (Array.isArray(arr)) for (const p of arr) postures.add(p);
  }
  return Array.from(postures).sort().join(', ') || '(no posture declared)';
}

function formatPersonaTenets(persona: BrandPersona): string {
  // Surface first ~6 lines of prose_body as tenets context. Keeps the prompt
  // grounded without ballooning token count on long persona docs.
  const lines = persona.prose_body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .slice(0, 6);
  return lines.length ? lines.map((l) => `- ${l}`).join('\n') : '(no prose tenets)';
}

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
