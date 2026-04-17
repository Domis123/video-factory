import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { env } from '../config/env.js';
import { retrieveCandidatesForSlot, type BriefSlot, type CandidateSegment } from './curator-v2-retrieval.js';
import {
  trimSegmentFromR2,
  uploadSegmentsToGemini,
  cleanupGeminiSegments,
  cleanupParentCache,
  type TrimmedSegment,
} from '../lib/segment-trimmer.js';
import { withLLMRetry } from '../lib/retry-llm.js';

// ── Types ──

export interface CuratorV2Result {
  slotIndex: number;
  segmentId: string;
  parentAssetId: string;
  parentR2Key: string;
  trimStartS: number;
  trimEndS: number;
  score: number;
  reasoning: string;
  candidateCount: number;
}

export interface CuratorV2Brief {
  slots: BriefSlot[];
  brandId: string;
  creative_vision?: string;
}

// ── Prompt + model config ──

const PROMPT_PATH = resolve(
  new URL('.', import.meta.url).pathname,
  './prompts/asset-curator-v2.md',
);
const PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, 'utf-8');

const MODEL_ID = process.env['GEMINI_CURATOR_MODEL']
  ?? process.env['GEMINI_INGESTION_MODEL']
  ?? 'gemini-2.5-pro';

const WORK_DIR = `${env.RENDER_TEMP_DIR}/curator-v2`;

// ── Zod schema for Pro's pick ──

const pickSchema = z.object({
  picked_segment_id: z.string().min(1),
  score: z.number().min(1).max(10),
  reasoning: z.string().min(1),
});

// ── Timing accumulator ──

interface PhaseTotals {
  retrieveMs: number;
  trimMs: number;
  uploadMs: number;
  pickMs: number;
  critiqueMs: number;
}

// ── Main entry point ──

/**
 * Curate assets for all slots in a brief using Gemini Pro with native video input.
 * Processes slots serially (parallel trim would risk VPS memory).
 * Parent files are cached across slots to avoid redundant R2 downloads.
 */
export async function curateWithV2(
  brief: CuratorV2Brief,
  previousPicks?: CuratorV2Result[],
): Promise<CuratorV2Result[]> {
  console.log(`[curator-v2] Starting V2 curation for ${brief.brandId}, ${brief.slots.length} slots`);

  const results: CuratorV2Result[] = [...(previousPicks ?? [])];
  const parentCache = new Map<string, string>();
  const totals: PhaseTotals = { retrieveMs: 0, trimMs: 0, uploadMs: 0, pickMs: 0, critiqueMs: 0 };
  const overallStart = Date.now();

  try {
    for (const slot of brief.slots) {
      console.log(`\n[curator-v2] ── Slot ${slot.index} ──`);
      const result = await curateSlot(slot, brief, results, parentCache, totals);
      results.push(result);
    }
  } finally {
    await cleanupParentCache(parentCache);
  }

  const overallMs = Date.now() - overallStart;
  console.log(
    `\n[curator-v2] Total wall time: ${(overallMs / 1000).toFixed(1)}s. ` +
    `Phase totals: retrieve=${(totals.retrieveMs / 1000).toFixed(1)}s, ` +
    `trim=${(totals.trimMs / 1000).toFixed(1)}s, ` +
    `upload=${(totals.uploadMs / 1000).toFixed(1)}s, ` +
    `pick=${(totals.pickMs / 1000).toFixed(1)}s`,
  );
  console.log(`[curator-v2] Curation complete: ${results.length} slots filled`);

  return results;
}

// ── Per-slot curation ──

async function curateSlot(
  slot: BriefSlot,
  brief: CuratorV2Brief,
  previousResults: CuratorV2Result[],
  parentCache: Map<string, string>,
  totals: PhaseTotals,
): Promise<CuratorV2Result> {
  const slotStart = Date.now();
  let retrieveMs = 0, trimMs = 0, uploadMs = 0, pickMs = 0, critiqueMs = 0;

  // 1. Retrieve candidates
  let t0 = Date.now();
  let candidates = await retrieveCandidatesForSlot(slot, brief.brandId, 15);

  // Retry with lower quality if empty
  if (candidates.length === 0 && slot.min_quality > 2) {
    const fallbackQuality = Math.max(1, slot.min_quality - 2);
    console.warn(`[curator-v2] Slot ${slot.index}: zero candidates, retrying with min_quality=${fallbackQuality}`);
    candidates = await retrieveCandidatesForSlot(
      { ...slot, min_quality: fallbackQuality },
      brief.brandId,
      15,
    );
  }
  retrieveMs = Date.now() - t0;

  // Exclude segments already picked in earlier slots
  const pickedIds = new Set(previousResults.map((r) => r.segmentId).filter(Boolean));
  if (pickedIds.size > 0) {
    const before = candidates.length;
    candidates = candidates.filter((c) => !pickedIds.has(c.segmentId));
    if (candidates.length < before) {
      console.log(`[curator-v2] Slot ${slot.index}: filtered ${before - candidates.length} already-picked segments (${candidates.length} remaining)`);
    }
  }

  // Still empty — return placeholder
  if (candidates.length === 0) {
    console.error(`[curator-v2] Slot ${slot.index}: no candidates even after quality fallback`);
    logSlotTiming(slot.index, retrieveMs, 0, 0, 0, 0, Date.now() - slotStart);
    return placeholderResult(slot);
  }

  // 2. Trim candidates (serial to avoid memory pressure)
  t0 = Date.now();
  const trimmedSegments: TrimmedSegment[] = [];
  const slotWorkDir = `${WORK_DIR}/slot-${slot.index}`;

  try {
    for (const candidate of candidates) {
      try {
        const trimmed = await trimSegmentFromR2(
          candidate.parentR2Key,
          candidate.startS,
          candidate.endS,
          candidate.segmentId,
          slotWorkDir,
          parentCache,
          candidate.clipR2Key,
        );
        trimmedSegments.push(trimmed);
      } catch (err) {
        console.warn(`[curator-v2] Failed to trim candidate ${candidate.segmentId}: ${(err as Error).message}`);
      }
    }
    trimMs = Date.now() - t0;

    if (trimmedSegments.length === 0) {
      console.error(`[curator-v2] Slot ${slot.index}: all trims failed`);
      logSlotTiming(slot.index, retrieveMs, trimMs, 0, 0, 0, Date.now() - slotStart);
      return fallbackResult(slot, candidates);
    }

    // 3. Upload to Gemini (parallel — I/O bound, safe)
    t0 = Date.now();
    await uploadSegmentsToGemini(trimmedSegments);
    uploadMs = Date.now() - t0;

    // 4. Build prompt
    const candidateMap = new Map(candidates.map((c) => [c.segmentId, c]));
    const activeTrimmed = trimmedSegments.filter((t) => t.geminiFileName);

    const metadataBlock = activeTrimmed.map((t, i) => {
      const c = candidateMap.get(t.segmentId)!;
      return `Candidate ${i + 1} (ID: ${c.segmentId}): type=${c.segmentType}, quality=${c.qualityScore}/10, duration=${c.durationS.toFixed(1)}s, parent=${c.parentR2Key}, description="${c.description}"`;
    }).join('\n');

    // Build previously-picked context for variety
    let previousPicksStr: string;
    if (previousResults.length > 0) {
      const pickedParents = previousResults
        .filter((r) => r.parentR2Key)
        .map((r) => r.parentR2Key);
      previousPicksStr = pickedParents.join(', ');
    } else {
      previousPicksStr = '(none — this is the first slot)';
    }

    const prompt = PROMPT_TEMPLATE
      .replace('{slot_description}', slot.description)
      .replace('{creative_vision}', brief.creative_vision ?? '(no overall creative direction specified)')
      .replace('{aesthetic_guidance}', slot.aesthetic_guidance ?? '(no specific aesthetic notes for this slot)')
      .replace('{valid_types}', slot.valid_segment_types.join(', '))
      .replace('{min_quality}', String(slot.min_quality))
      .replace('{slot_index}', String(slot.index + 1))
      .replace('{total_slots}', String(brief.slots.length))
      .replace('{previously_picked_parents}', previousPicksStr)
      .replace('{candidate_metadata_block}', metadataBlock);

    // 5. Call Gemini Pro with video parts
    t0 = Date.now();
    const pick = await callProPicker(activeTrimmed, prompt, slot, candidateMap, 'curator-v2-pick');
    pickMs = Date.now() - t0;

    // 6. Self-critique: if score < 7, ask for a second pick
    if (pick.score < 7) {
      t0 = Date.now();
      console.log(`[curator-v2] Slot ${slot.index}: score ${pick.score}/10, running self-critique...`);
      const critiquePrompt =
        `You scored your previous pick ${pick.score}/10 (${pick.reasoning}). ` +
        `Pick a DIFFERENT candidate from the same list and explain why it's better.\n\n` +
        prompt;

      const secondPick = await callProPicker(activeTrimmed, critiquePrompt, slot, candidateMap, 'curator-v2-critique');
      critiqueMs = Date.now() - t0;

      if (secondPick.score >= 7) {
        console.log(`[curator-v2] Slot ${slot.index}: self-critique improved to ${secondPick.score}/10`);
        logSlotTiming(slot.index, retrieveMs, trimMs, uploadMs, pickMs, critiqueMs, Date.now() - slotStart);
        addToTotals(totals, retrieveMs, trimMs, uploadMs, pickMs, critiqueMs);
        return secondPick;
      }
      console.warn(`[curator-v2] Slot ${slot.index}: self-critique scored ${secondPick.score}/10, keeping first pick`);
    }

    logSlotTiming(slot.index, retrieveMs, trimMs, uploadMs, pickMs, critiqueMs, Date.now() - slotStart);
    addToTotals(totals, retrieveMs, trimMs, uploadMs, pickMs, critiqueMs);
    return pick;
  } finally {
    // Cleanup: Gemini files + local trims (parent cache cleaned at outer level)
    await cleanupGeminiSegments(trimmedSegments);
    for (const t of trimmedSegments) {
      await unlink(t.localPath).catch(() => {});
    }
  }
}

// ── Timing helpers ──

function logSlotTiming(
  slotIndex: number,
  retrieveMs: number, trimMs: number, uploadMs: number,
  pickMs: number, critiqueMs: number, totalMs: number,
) {
  console.log(
    `[curator-v2] Slot ${slotIndex} timing: ` +
    `retrieve=${(retrieveMs / 1000).toFixed(1)}s, ` +
    `trim=${(trimMs / 1000).toFixed(1)}s, ` +
    `upload=${(uploadMs / 1000).toFixed(1)}s, ` +
    `pick=${(pickMs / 1000).toFixed(1)}s, ` +
    `critique=${(critiqueMs / 1000).toFixed(1)}s, ` +
    `total=${(totalMs / 1000).toFixed(1)}s`,
  );
}

function addToTotals(
  totals: PhaseTotals,
  retrieveMs: number, trimMs: number, uploadMs: number,
  pickMs: number, critiqueMs: number,
) {
  totals.retrieveMs += retrieveMs;
  totals.trimMs += trimMs;
  totals.uploadMs += uploadMs;
  totals.pickMs += pickMs;
  totals.critiqueMs += critiqueMs;
}

// ── Gemini Pro picker call ──

async function callProPicker(
  trimmedSegments: TrimmedSegment[],
  prompt: string,
  slot: BriefSlot,
  candidateMap: Map<string, CandidateSegment>,
  label: string,
): Promise<CuratorV2Result> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    } as Record<string, unknown>,
  });

  // Build content parts: video files + text prompt
  const parts: any[] = [];
  for (const t of trimmedSegments) {
    if (!t.geminiFileUri) continue;
    parts.push({
      fileData: {
        mimeType: 'video/mp4',
        fileUri: t.geminiFileUri,
      },
    });
  }
  parts.push({ text: prompt });

  console.log(`[curator-v2] Calling ${MODEL_ID} for slot ${slot.index} with ${trimmedSegments.length} candidates...`);
  const result = await withLLMRetry(() => model.generateContent(parts), { label });
  const text = result.response.text();

  // Parse response
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Failed to parse Pro response for slot ${slot.index}: ${text.slice(0, 200)}`);
    raw = JSON.parse(match[0]);
  }

  let pick: z.infer<typeof pickSchema>;
  const parsed = pickSchema.safeParse(raw);
  if (parsed.success) {
    pick = parsed.data;
  } else {
    console.warn(
      `[curator-v2] Slot ${slot.index}: initial Zod validation failed, attempting corrective retry:`,
      parsed.error.issues,
    );
    try {
      const zodErrorLines = parsed.error.issues
        .map((e) => `- ${e.path.join('.')}: ${e.message}`)
        .join('\n');
      const correctivePrompt =
        prompt +
        `\n\nYour previous response failed schema validation:\n\n${zodErrorLines}\n\n` +
        `Return ONLY valid JSON matching the required schema. Do not wrap in markdown fences or add explanation outside the JSON object.`;

      const correctiveParts: any[] = [];
      for (const t of trimmedSegments) {
        if (!t.geminiFileUri) continue;
        correctiveParts.push({
          fileData: { mimeType: 'video/mp4', fileUri: t.geminiFileUri },
        });
      }
      correctiveParts.push({ text: correctivePrompt });

      const correctiveResult = await withLLMRetry(
        () => model.generateContent(correctiveParts),
        { label: `${label}-corrective`, maxAttempts: 2 },
      );
      const correctiveText = correctiveResult.response.text();

      let correctiveRaw: unknown;
      try {
        correctiveRaw = JSON.parse(correctiveText);
      } catch {
        const m = correctiveText.match(/\{[\s\S]*\}/);
        if (!m) throw new Error(`Failed to parse Pro corrective response for slot ${slot.index}: ${correctiveText.slice(0, 200)}`);
        correctiveRaw = JSON.parse(m[0]);
      }

      const correctiveParsed = pickSchema.safeParse(correctiveRaw);
      if (!correctiveParsed.success) {
        throw new Error('Pro response failed Zod validation after corrective retry');
      }
      pick = correctiveParsed.data;
      console.log(`[curator-v2] Slot ${slot.index}: corrective retry succeeded`);
    } catch (err) {
      console.error(
        `[curator-v2] Slot ${slot.index}: Pro failed Zod validation twice (initial + corrective), falling back to highest-quality candidate: ${(err as Error).message}`,
      );
      return fallbackResult(slot, [...candidateMap.values()]);
    }
  }

  // Validate picked ID exists in candidates
  const picked = candidateMap.get(pick.picked_segment_id);
  if (!picked) {
    console.error(`[curator-v2] Slot ${slot.index}: Pro picked unknown ID "${pick.picked_segment_id}", using highest-quality fallback`);
    return fallbackResult(slot, [...candidateMap.values()]);
  }

  console.log(`[curator-v2] Slot ${slot.index}: picked ${picked.segmentId} (${picked.segmentType}, q=${picked.qualityScore}) score=${pick.score}/10`);

  return {
    slotIndex: slot.index,
    segmentId: picked.segmentId,
    parentAssetId: picked.parentAssetId,
    parentR2Key: picked.parentR2Key,
    trimStartS: picked.startS,
    trimEndS: picked.endS,
    score: pick.score,
    reasoning: pick.reasoning,
    candidateCount: candidateMap.size,
  };
}

// ── Fallback / placeholder helpers ──

function placeholderResult(slot: BriefSlot): CuratorV2Result {
  return {
    slotIndex: slot.index,
    segmentId: '',
    parentAssetId: '',
    parentR2Key: '',
    trimStartS: 0,
    trimEndS: 0,
    score: 0,
    reasoning: 'No candidates found in asset_segments for this slot',
    candidateCount: 0,
  };
}

function fallbackResult(slot: BriefSlot, candidates: CandidateSegment[]): CuratorV2Result {
  const best = candidates.sort((a, b) => b.qualityScore - a.qualityScore)[0];
  if (!best) return placeholderResult(slot);
  return {
    slotIndex: slot.index,
    segmentId: best.segmentId,
    parentAssetId: best.parentAssetId,
    parentR2Key: best.parentR2Key,
    trimStartS: best.startS,
    trimEndS: best.endS,
    score: 3,
    reasoning: 'Fallback: Pro response invalid, picked highest-quality candidate',
    candidateCount: candidates.length,
  };
}
