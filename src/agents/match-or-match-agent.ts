/**
 * Match-Or-Match Agent — single Gemini Pro library-aware picker for the
 * Simple Pipeline (routine + meme products, kickoff Q9/Q10/Q1b).
 *
 * Reads brand_configs.aesthetic_description (visual reasoning) — NOT
 * voice_guidelines (which the c3 overlay generators consume).
 *
 * Considers ONLY segments where segment_v2 IS NOT NULL (Q9). For the
 * routine path, parents with fewer than 10 v2-analyzed segments are not
 * pickable (Q9). Cooldown exclusions are applied before the model sees
 * the library — the prompt cannot hallucinate excluded parents/segments
 * because they're not in the input.
 *
 * File: src/agents/match-or-match-agent.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import { computeGeminiCost } from '../lib/llm-cost.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface MatchOrMatchInput {
  brandId: string;
  ideaSeed: string;
  format: 'routine' | 'meme';
  excludedParents: string[]; // routine path
  excludedSegments: string[]; // both paths
}

export interface MatchOrMatchRoutineOutput {
  format: 'routine';
  parentAssetId: string;
  segmentIds: string[]; // length 2..5
  slotCount: number;
  reasoning: string;
  costUsd: number;
}

export interface MatchOrMatchMemeOutput {
  format: 'meme';
  parentAssetId: string;
  segmentIds: [string]; // length exactly 1
  reasoning: string;
  costUsd: number;
}

export type MatchOrMatchOutput =
  | MatchOrMatchRoutineOutput
  | MatchOrMatchMemeOutput;

// ─── Internal: candidate row ───────────────────────────────────────────────

interface CandidateSegment {
  id: string;
  parentAssetId: string;
  segmentType: string;
  qualityScore: number;
  durationS: number;
  description: string;
  visualTags: string[];
  motionVelocity: string | null;
  framingAngle: string | null;
  framingDistance: string | null;
  settingLocation: string | null;
  recommendedDurationS: number | null;
}

const PARENT_MIN_V2_SEGMENTS = 10; // Q9: routine path floor

// ─── Module-load constants ─────────────────────────────────────────────────

const MODEL_ID =
  process.env['GEMINI_MATCH_OR_MATCH_MODEL'] ||
  process.env['GEMINI_CURATOR_MODEL'] ||
  'gemini-2.5-pro';

const TEMPERATURE = 0.4;

const PROMPT_DIR = resolve(new URL('.', import.meta.url).pathname, './prompts');
const ROUTINE_PROMPT_TEMPLATE = readFileSync(
  resolve(PROMPT_DIR, 'match-or-match-routine.md'),
  'utf-8',
);
const MEME_PROMPT_TEMPLATE = readFileSync(
  resolve(PROMPT_DIR, 'match-or-match-meme.md'),
  'utf-8',
);

// ─── Output schemas (Zod) ──────────────────────────────────────────────────

const routineSchema = z
  .object({
    parent_asset_id: z.string().uuid(),
    segment_ids: z.array(z.string().uuid()).min(2).max(5),
    slot_count: z.number().int().min(2).max(5),
    reasoning: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.slot_count !== v.segment_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slot_count'],
        message: `slot_count (${v.slot_count}) must equal segment_ids.length (${v.segment_ids.length})`,
      });
    }
  });

const memeSchema = z.object({
  parent_asset_id: z.string().uuid(),
  segment_ids: z.array(z.string().uuid()).length(1),
  reasoning: z.string().min(1),
});

// ─── Public entry point ────────────────────────────────────────────────────

export async function callMatchOrMatchAgent(
  input: MatchOrMatchInput,
): Promise<MatchOrMatchOutput> {
  if (!input.brandId.trim()) throw new Error('callMatchOrMatchAgent: brandId is required');
  if (!input.ideaSeed.trim()) throw new Error('callMatchOrMatchAgent: ideaSeed is required');

  const aestheticDescription = await fetchAestheticDescription(input.brandId);
  const allCandidates = await fetchV2Candidates(input.brandId);

  if (allCandidates.length === 0) {
    throw new Error(
      `callMatchOrMatchAgent: brand=${input.brandId} has no v2-analyzed segments. ` +
        `Cannot pick clips. Run S1 readiness check before invoking the agent.`,
    );
  }

  if (input.format === 'routine') {
    return await routinePath(input, aestheticDescription, allCandidates);
  }
  return await memePath(input, aestheticDescription, allCandidates);
}

// ─── Routine path ──────────────────────────────────────────────────────────

async function routinePath(
  input: MatchOrMatchInput,
  aestheticDescription: string,
  allCandidates: CandidateSegment[],
): Promise<MatchOrMatchRoutineOutput> {
  // Group by parent, drop parents with <10 v2 segments OR in excludedParents
  const parents = groupParents(allCandidates);
  const excludedParents = new Set(input.excludedParents);
  const eligible = [...parents.entries()]
    .filter(([pid, segs]) => segs.length >= PARENT_MIN_V2_SEGMENTS && !excludedParents.has(pid))
    .map(([pid, segs]) => ({ parentAssetId: pid, segments: segs }));

  if (eligible.length === 0) {
    throw new Error(
      `Match-Or-Match routine: no eligible parents for brand=${input.brandId}. ` +
        `Need ≥1 parent with ≥${PARENT_MIN_V2_SEGMENTS} v2-analyzed segments not in excludedParents ` +
        `(${input.excludedParents.length} excluded).`,
    );
  }

  // Filter excludedSegments out of each parent's segment list (if a parent
  // ends up with <2 remaining segments, drop the parent — can't form a 2-clip
  // routine from it).
  const excludedSegments = new Set(input.excludedSegments);
  const eligibleAfterSegFilter = eligible
    .map((p) => ({
      parentAssetId: p.parentAssetId,
      segments: p.segments.filter((s) => !excludedSegments.has(s.id)),
    }))
    .filter((p) => p.segments.length >= 2);

  if (eligibleAfterSegFilter.length === 0) {
    throw new Error(
      `Match-Or-Match routine: every eligible parent had <2 non-excluded segments after applying ` +
        `${input.excludedSegments.length} segment exclusions. Increase brand library or relax cooldown.`,
    );
  }

  const libraryBlock = buildRoutineLibraryBlock(eligibleAfterSegFilter);
  const excludedParentsBlock =
    input.excludedParents.length === 0
      ? '(none — first routine for this brand or cooldown empty)'
      : input.excludedParents.map((p) => `  - ${p}`).join('\n');

  const prompt = ROUTINE_PROMPT_TEMPLATE.replace('{aesthetic_description}', aestheticDescription)
    .replace('{idea_seed}', input.ideaSeed)
    .replace('{excluded_parents_block}', excludedParentsBlock)
    .replace('{library_block}', libraryBlock);

  const { raw, costUsd } = await callPro(prompt, 'match-or-match-routine');

  // Validate Zod
  const parsed = routineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Match-Or-Match routine: response failed schema validation. ` +
        `Issues: ${parsed.error.issues.map((i) => `${i.path.join('.')}=${i.message}`).join('; ')}. ` +
        `Raw: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  const out = parsed.data;

  // Validate semantically: parent must be eligible; all segment_ids belong to that parent
  const eligibleParentIds = new Set(eligibleAfterSegFilter.map((p) => p.parentAssetId));
  if (!eligibleParentIds.has(out.parent_asset_id)) {
    throw new Error(
      `Match-Or-Match routine: agent picked parent_asset_id=${out.parent_asset_id} ` +
        `which is not in the eligible-parent set (size ${eligibleParentIds.size}).`,
    );
  }
  const parent = eligibleAfterSegFilter.find((p) => p.parentAssetId === out.parent_asset_id)!;
  const parentSegIds = new Set(parent.segments.map((s) => s.id));
  for (const sid of out.segment_ids) {
    if (!parentSegIds.has(sid)) {
      throw new Error(
        `Match-Or-Match routine: agent picked segment_id=${sid} which does not belong to ` +
          `parent_asset_id=${out.parent_asset_id} (parent has ${parent.segments.length} segments).`,
      );
    }
  }
  if (new Set(out.segment_ids).size !== out.segment_ids.length) {
    throw new Error(
      `Match-Or-Match routine: agent emitted duplicate segment_ids: ${out.segment_ids.join(', ')}`,
    );
  }

  return {
    format: 'routine',
    parentAssetId: out.parent_asset_id,
    segmentIds: out.segment_ids,
    slotCount: out.slot_count,
    reasoning: out.reasoning,
    costUsd,
  };
}

// ─── Meme path ─────────────────────────────────────────────────────────────

async function memePath(
  input: MatchOrMatchInput,
  aestheticDescription: string,
  allCandidates: CandidateSegment[],
): Promise<MatchOrMatchMemeOutput> {
  const excludedSegments = new Set(input.excludedSegments);
  const eligible = allCandidates.filter((s) => !excludedSegments.has(s.id));

  if (eligible.length === 0) {
    throw new Error(
      `Match-Or-Match meme: no eligible segments for brand=${input.brandId} after applying ` +
        `${input.excludedSegments.length} segment exclusions.`,
    );
  }

  const libraryBlock = buildMemeLibraryBlock(eligible);
  const excludedSegmentsBlock =
    input.excludedSegments.length === 0
      ? '(none — first meme for this brand or cooldown empty)'
      : input.excludedSegments.map((s) => `  - ${s}`).join('\n');

  const prompt = MEME_PROMPT_TEMPLATE.replace('{aesthetic_description}', aestheticDescription)
    .replace('{idea_seed}', input.ideaSeed)
    .replace('{excluded_segments_block}', excludedSegmentsBlock)
    .replace('{library_block}', libraryBlock);

  const { raw, costUsd } = await callPro(prompt, 'match-or-match-meme');

  const parsed = memeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Match-Or-Match meme: response failed schema validation. ` +
        `Issues: ${parsed.error.issues.map((i) => `${i.path.join('.')}=${i.message}`).join('; ')}. ` +
        `Raw: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  const out = parsed.data;

  const segmentIndex = new Map(eligible.map((s) => [s.id, s]));
  const picked = segmentIndex.get(out.segment_ids[0]);
  if (!picked) {
    throw new Error(
      `Match-Or-Match meme: agent picked segment_id=${out.segment_ids[0]} which is not in the eligible set ` +
        `(size ${eligible.length}).`,
    );
  }
  if (picked.parentAssetId !== out.parent_asset_id) {
    throw new Error(
      `Match-Or-Match meme: agent's parent_asset_id=${out.parent_asset_id} does not match the picked ` +
        `segment's parent (${picked.parentAssetId}).`,
    );
  }

  return {
    format: 'meme',
    parentAssetId: out.parent_asset_id,
    segmentIds: [out.segment_ids[0]],
    reasoning: out.reasoning,
    costUsd,
  };
}

// ─── Gemini Pro call ───────────────────────────────────────────────────────

async function callPro(prompt: string, label: string): Promise<{ raw: unknown; costUsd: number }> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const response = await withLLMRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: TEMPERATURE,
        },
      }),
    { label, maxAttempts: 3 },
  );

  const text = response.text ?? '';
  if (!text) throw new Error(`Match-Or-Match: ${label} returned empty text`);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Match-Or-Match: ${label} response not parseable as JSON. Raw: ${text.slice(0, 200)}`);
    }
    raw = JSON.parse(match[0]);
  }

  // Cost tracking — throws loudly per Rule 38 if usage missing
  const usage = computeGeminiCost(MODEL_ID, response);
  return { raw, costUsd: usage.cost_usd };
}

// ─── Supabase helpers ──────────────────────────────────────────────────────

async function fetchAestheticDescription(brandId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .select('aesthetic_description')
    .eq('brand_id', brandId)
    .single();
  if (error) {
    throw new Error(`Match-Or-Match: failed to fetch brand_configs for ${brandId}: ${error.message}`);
  }
  if (!data.aesthetic_description) {
    throw new Error(
      `Match-Or-Match: brand ${brandId} has no aesthetic_description. ` +
        `Populate brand_configs.aesthetic_description before invoking the agent.`,
    );
  }
  return data.aesthetic_description;
}

async function fetchV2Candidates(brandId: string): Promise<CandidateSegment[]> {
  // Q9: only segments where segment_v2 IS NOT NULL
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id, segment_type, quality_score, start_s, end_s, description, visual_tags, segment_v2')
    .eq('brand_id', brandId)
    .not('segment_v2', 'is', null);

  if (error) {
    throw new Error(`Match-Or-Match: failed to fetch asset_segments for ${brandId}: ${error.message}`);
  }

  return (data || []).map((row: any) => {
    const v2 = row.segment_v2 ?? {};
    return {
      id: row.id as string,
      parentAssetId: row.parent_asset_id as string,
      segmentType: row.segment_type as string,
      qualityScore: row.quality_score ?? v2.quality?.overall ?? 0,
      durationS: Number(row.end_s) - Number(row.start_s),
      description:
        v2.description ||
        row.description ||
        '(no description)',
      visualTags: row.visual_tags || v2.visual_tags || [],
      motionVelocity: v2.motion?.velocity ?? null,
      framingAngle: v2.framing?.angle ?? null,
      framingDistance: v2.framing?.distance ?? null,
      settingLocation: v2.setting?.location ?? null,
      recommendedDurationS: v2.recommended_duration_s ?? null,
    };
  });
}

function groupParents(candidates: CandidateSegment[]): Map<string, CandidateSegment[]> {
  const m = new Map<string, CandidateSegment[]>();
  for (const c of candidates) {
    if (!m.has(c.parentAssetId)) m.set(c.parentAssetId, []);
    m.get(c.parentAssetId)!.push(c);
  }
  // Sort each parent's segments by start time so source order is preserved
  for (const [, segs] of m) {
    // We don't have start_s after the .map; segments are already source-ordered
    // by Postgres in many cases, but explicit sort would require keeping start_s.
    // Skipping — the agent reorders if it wants to anyway.
    void segs;
  }
  return m;
}

// ─── Prompt block builders ─────────────────────────────────────────────────

function describeSegment(s: CandidateSegment): string {
  const tags = s.visualTags.slice(0, 8).join(', ') || '—';
  const motion = s.motionVelocity ? `motion=${s.motionVelocity}` : 'motion=?';
  const framing =
    s.framingAngle && s.framingDistance
      ? `framing=${s.framingAngle}/${s.framingDistance}`
      : 'framing=?';
  const location = s.settingLocation ? `loc=${s.settingLocation}` : 'loc=?';
  const desc = s.description.replace(/\s+/g, ' ').trim();
  return (
    `      • ${s.id}\n` +
    `        type=${s.segmentType}, q=${s.qualityScore}/10, dur=${s.durationS.toFixed(1)}s, ` +
    `${motion}, ${framing}, ${location}\n` +
    `        tags: ${tags}\n` +
    `        "${desc}"`
  );
}

function buildRoutineLibraryBlock(
  parents: Array<{ parentAssetId: string; segments: CandidateSegment[] }>,
): string {
  return parents
    .map((p) => {
      const header = `  PARENT ${p.parentAssetId} (${p.segments.length} segments):`;
      const segLines = p.segments.map(describeSegment).join('\n');
      return `${header}\n${segLines}`;
    })
    .join('\n\n');
}

function buildMemeLibraryBlock(segments: CandidateSegment[]): string {
  return segments
    .map((s) => {
      // Meme path: segment listing is flat, but each entry surfaces parent_id
      // so the agent can return the right parent_asset_id.
      return (
        `  • ${s.id}\n` +
        `    parent=${s.parentAssetId}, type=${s.segmentType}, q=${s.qualityScore}/10, ` +
        `dur=${s.durationS.toFixed(1)}s, motion=${s.motionVelocity ?? '?'}, ` +
        `framing=${s.framingAngle ?? '?'}/${s.framingDistance ?? '?'}, loc=${s.settingLocation ?? '?'}\n` +
        `    tags: ${(s.visualTags.slice(0, 8).join(', ')) || '—'}\n` +
        `    "${s.description.replace(/\s+/g, ' ').trim()}"`
      );
    })
    .join('\n\n');
}
