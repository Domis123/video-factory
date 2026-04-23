/**
 * Copywriter v2 (W7) — Part B, post-select.
 *
 * `writeCopyForStoryboard` is a pure function:
 *   (plannerOutput, picks, brandPersona, segment_snapshots) → CopyPackage
 *
 * Single text-only Gemini call (gemini-3.1-pro-preview via @google/genai,
 * temperature 0.5). The agent produces one complete copy package per video:
 * hook + per-slot overlays + CTA + platform captions + hashtags.
 *
 * Seven semantic validation checks run AFTER Zod parse (Rule 38 — loud throws,
 * no silent correct). Each check has a distinct error class so the W8
 * orchestrator can distinguish retriable (LLM variance) from non-retriable
 * (prompt bug).
 *
 * The segment snapshot reused from W6 (`CandidateMetadataSnapshot`) doesn't
 * carry every field the W7 prompt needs, so this file defines a richer
 * `CopywriterSegmentSnapshot` and a local fetch helper that extracts from
 * `asset_segments.segment_v2` JSONB. W6's shipped snapshot is NOT modified
 * (Rule 36 — additive only).
 *
 * Not yet wired. W8 orchestrator is first consumer; W9 shadows.
 *
 * File: src/agents/copywriter-v2.ts
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
  CopyPackageSchema,
  type CopyPackage,
  CaptionSanityError,
  HashtagFormatError,
  HookDeliveryCoherenceError,
  OnScreenTextCollisionError,
  OverlayTextNullError,
  OverlayTimingError,
  OverlayTypeConstraintError,
} from '../types/copywriter-output.js';
import type { BrandPersona } from '../types/brand-persona.js';
import type { PlannerOutput, PlannerSlot } from '../types/planner-output.js';
import type { SlotPick, StoryboardPicks } from '../types/slot-pick.js';

const COPYWRITER_MODEL =
  process.env['GEMINI_COPYWRITER_MODEL'] || 'gemini-3.1-pro-preview';
const TEMPERATURE = 0.5;
const MAX_OUTPUT_TOKENS = 4000;

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, './prompts/copywriter-v2.md'),
  'utf-8',
);

// Strip Zod bound keywords before submitting to Gemini's responseSchema. W3
// learning (repeated in W5, W6): Gemini rejects dense enum + bounds
// combinations. Zod still enforces bounds on the returned JSON.
const BOUND_KEYS_TO_STRIP = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
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

const RAW_COPY_JSON_SCHEMA = zodToJsonSchema(CopyPackageSchema, {
  target: 'openApi3',
  $refStrategy: 'none',
});
const COPY_JSON_SCHEMA = stripSchemaBounds(RAW_COPY_JSON_SCHEMA) as Record<
  string,
  unknown
>;

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot — richer than W6's CandidateMetadataSnapshot
// ─────────────────────────────────────────────────────────────────────────────

export interface CopywriterSegmentSnapshot {
  segment_id: string;
  segment_type: string;
  duration_s: number;
  exercise: {
    name: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
  };
  setting: {
    location: string;
    equipment_visible: string[];
    on_screen_text: string | null;
  };
  posture: string;
  body_focus: string[];
  description: string;
}

interface SegmentRowForCopywriter {
  id: string;
  segment_type: string | null;
  start_s: number | null;
  end_s: number | null;
  description: string | null;
  segment_v2: unknown;
}

export async function fetchCopywriterSnapshots(
  segmentIds: string[],
): Promise<Map<string, CopywriterSegmentSnapshot>> {
  const out = new Map<string, CopywriterSegmentSnapshot>();
  if (segmentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, segment_type, start_s, end_s, description, segment_v2')
    .in('id', segmentIds);
  if (error) {
    throw new Error(`[copywriter-v2] snapshot fetch failed: ${error.message}`);
  }
  for (const row of (data ?? []) as SegmentRowForCopywriter[]) {
    out.set(row.id, rowToCopywriterSnapshot(row));
  }
  for (const id of segmentIds) {
    if (!out.has(id)) {
      throw new Error(
        `[copywriter-v2] snapshot fetch: segment_id ${id} not found in asset_segments`,
      );
    }
  }
  return out;
}

function rowToCopywriterSnapshot(
  r: SegmentRowForCopywriter,
): CopywriterSegmentSnapshot {
  const v2 = (r.segment_v2 ?? {}) as Record<string, unknown>;
  const exercise = (v2['exercise'] ?? {}) as Record<string, unknown>;
  const setting = (v2['setting'] ?? {}) as Record<string, unknown>;
  const audio = (v2['audio'] ?? {}) as Record<string, unknown>;
  const framing = (v2['framing'] ?? {}) as Record<string, unknown>;

  const duration =
    r.start_s != null && r.end_s != null ? Math.max(0, r.end_s - r.start_s) : 0;

  const bodyFocus = Array.isArray(exercise['body_regions'])
    ? (exercise['body_regions'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];

  const equipment = Array.isArray(setting['equipment_visible'])
    ? (setting['equipment_visible'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];

  const rawConfidence = exercise['name_confidence'];
  const confidence =
    rawConfidence === 'high' ||
    rawConfidence === 'medium' ||
    rawConfidence === 'low'
      ? rawConfidence
      : null;

  // on_screen_text lives under segment_v2.audio per W6's reading; some v2
  // variants nested it under setting instead — check both to be robust to the
  // schema-v2 migration.
  const ostFromAudio =
    typeof audio['on_screen_text'] === 'string'
      ? (audio['on_screen_text'] as string)
      : null;
  const ostFromSetting =
    typeof setting['on_screen_text'] === 'string'
      ? (setting['on_screen_text'] as string)
      : null;

  return {
    segment_id: r.id,
    segment_type: r.segment_type ?? 'unknown',
    duration_s: +duration.toFixed(2),
    exercise: {
      name:
        typeof exercise['name'] === 'string'
          ? (exercise['name'] as string)
          : null,
      confidence,
    },
    setting: {
      location:
        typeof setting['location'] === 'string'
          ? (setting['location'] as string)
          : 'unknown',
      equipment_visible: equipment,
      on_screen_text: ostFromAudio ?? ostFromSetting,
    },
    posture: typeof framing['posture'] === 'string' ? (framing['posture'] as string) : 'unknown',
    body_focus: bodyFocus,
    description: r.description ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface WriteCopyInput {
  plannerOutput: PlannerOutput;
  picks: StoryboardPicks;
  brandPersona: BrandPersona;
  // Optional: pre-fetched snapshots (e.g., synthetic tests forcing specific
  // on_screen_text). When omitted, the wrapper queries Supabase for the picked
  // segment_ids' segment_v2 JSONB.
  segmentSnapshots?: Map<string, CopywriterSegmentSnapshot>;
}

export async function writeCopyForStoryboard(
  input: WriteCopyInput,
): Promise<CopyPackage> {
  const { plannerOutput, picks, brandPersona } = input;

  if (picks.picks.length !== plannerOutput.slots.length) {
    throw new Error(
      `[copywriter-v2] picks length ${picks.picks.length} !== slots length ${plannerOutput.slots.length}`,
    );
  }

  const snapshots =
    input.segmentSnapshots ??
    (await fetchCopywriterSnapshots(picks.picks.map((p) => p.picked_segment_id)));

  const prompt = renderPrompt(plannerOutput, picks, brandPersona, snapshots);

  const { parsed, retryCount } = await callGemini(prompt);

  // Stamp metadata with true retry count + temperature before semantic checks.
  // Zod has already validated, so we mutate the parsed object rather than
  // re-parsing.
  parsed.metadata.retry_count = retryCount;
  parsed.metadata.temperature = TEMPERATURE;

  // Semantic validation — throws distinct error classes (Rule 38, no silent
  // correct). Order: slot-level first (fail fast on the most common prompt
  // bugs), then cross-slot / whole-video.
  validateOverlayTypeConstraints(parsed, plannerOutput, picks, snapshots);
  validateOverlayTiming(parsed, plannerOutput);
  validateOverlayTextNull(parsed);
  validateHookDeliveryCoherence(parsed);
  validateCaptionSanity(parsed);
  validateHashtagFormat(parsed);
  validateOnScreenTextCollision(parsed, picks, snapshots);

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderPrompt(
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
  persona: BrandPersona,
  snapshots: Map<string, CopywriterSegmentSnapshot>,
): string {
  const snapshotsByPick = buildSnapshotsBySlot(plannerOutput, picks, snapshots);
  return PROMPT_TEMPLATE.replace(
    '{brand_persona_prose}',
    persona.prose_body || '(no prose body)',
  )
    .replace('{planner_output_json}', JSON.stringify(plannerOutput, null, 2))
    .replace('{segment_snapshots_json}', JSON.stringify(snapshotsByPick, null, 2));
}

function buildSnapshotsBySlot(
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
  snapshots: Map<string, CopywriterSegmentSnapshot>,
): Array<{
  slot_index: number;
  slot_id: string;
  snapshot: CopywriterSegmentSnapshot | null;
}> {
  const pickByIndex = new Map(picks.picks.map((p) => [p.slot_index, p]));
  return plannerOutput.slots.map((slot) => {
    const pick = pickByIndex.get(slot.slot_index);
    const snap = pick ? snapshots.get(pick.picked_segment_id) ?? null : null;
    return {
      slot_index: slot.slot_index,
      slot_id: slotIdFor(slot),
      snapshot: snap,
    };
  });
}

function slotIdFor(slot: PlannerSlot): string {
  return `slot-${slot.slot_index}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini call + parse retry
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(
  prompt: string,
): Promise<{ parsed: CopyPackage; retryCount: number }> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const maxParseAttempts = 2;
  let parseRetries = 0;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
    try {
      const response = await withLLMRetry(
        () =>
          ai.models.generateContent({
            model: COPYWRITER_MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: COPY_JSON_SCHEMA as Record<string, unknown>,
              temperature: TEMPERATURE,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
          }),
        { label: `copywriter-v2`, maxAttempts: 3 },
      );
      const text = response.text ?? '';
      if (!text) throw new Error('Gemini copywriter-v2 returned empty text');
      const raw = JSON.parse(text);
      const parsed = CopyPackageSchema.parse(raw);
      return { parsed, retryCount: parseRetries };
    } catch (err) {
      lastErr = err;
      const isParseErr =
        err instanceof z.ZodError ||
        err instanceof SyntaxError ||
        (err instanceof Error && err.message.includes('returned empty text'));
      if (isParseErr && attempt < maxParseAttempts) {
        parseRetries++;
        console.warn(
          `[copywriter-v2] attempt ${attempt} parse failed, retrying: ${messageOf(err)}`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('copywriter-v2 exhausted retries without a final error');
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic validation (Rule 38 — throw, never silent-correct)
// ─────────────────────────────────────────────────────────────────────────────

function validateOverlayTypeConstraints(
  pkg: CopyPackage,
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
  snapshots: Map<string, CopywriterSegmentSnapshot>,
): void {
  const pickBySlotIndex = new Map(picks.picks.map((p) => [p.slot_index, p]));
  const slotsByIndex = new Map(plannerOutput.slots.map((s) => [s.slot_index, s]));

  let captionCount = 0;
  for (const entry of pkg.per_slot) {
    const slotIndex = parseSlotIndex(entry.slot_id);
    const slot = slotsByIndex.get(slotIndex);
    if (!slot) {
      throw new OverlayTypeConstraintError(
        `slot_id "${entry.slot_id}" does not match any planner slot_index`,
      );
    }
    const pick = pickBySlotIndex.get(slotIndex);
    const snap = pick ? snapshots.get(pick.picked_segment_id) : undefined;
    const type = entry.overlay.type;

    if (type === 'label') {
      if (!snap) {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='label' but no snapshot available to verify exercise.name`,
        );
      }
      const name = snap.exercise.name;
      const conf = snap.exercise.confidence;
      if (!name || !(conf === 'high' || conf === 'medium')) {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='label' requires snapshot.exercise.name !== null and confidence ∈ {high, medium}; got name=${JSON.stringify(name)} confidence=${JSON.stringify(conf)}`,
        );
      }
    } else if (type === 'stamp') {
      if (!snap) {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='stamp' but no snapshot available to verify posture`,
        );
      }
      if (snap.posture !== 'P4' && snap.posture !== 'P5') {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='stamp' requires snapshot.posture ∈ {P4, P5}; got posture=${JSON.stringify(snap.posture)}`,
        );
      }
    } else if (type === 'count') {
      if (!snap) {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='count' but no snapshot available to verify segment_type`,
        );
      }
      if (snap.segment_type !== 'exercise') {
        throw new OverlayTypeConstraintError(
          `slot ${slotIndex}: overlay.type='count' requires snapshot.segment_type='exercise'; got segment_type=${JSON.stringify(snap.segment_type)}`,
        );
      }
    } else if (type === 'caption') {
      captionCount++;
    }
    // cue / none: always valid, no constraint.
  }

  if (captionCount > 2) {
    throw new OverlayTypeConstraintError(
      `overlay.type='caption' used ${captionCount} times across per_slot; max allowed is 2`,
    );
  }
}

function validateOverlayTiming(
  pkg: CopyPackage,
  plannerOutput: PlannerOutput,
): void {
  const slotsByIndex = new Map(plannerOutput.slots.map((s) => [s.slot_index, s]));
  for (const entry of pkg.per_slot) {
    const slotIndex = parseSlotIndex(entry.slot_id);
    const slot = slotsByIndex.get(slotIndex);
    if (!slot) {
      throw new OverlayTimingError(
        `slot_id "${entry.slot_id}" does not match any planner slot_index`,
      );
    }
    const { start_time_s, end_time_s } = entry.overlay;
    if (start_time_s < 0) {
      throw new OverlayTimingError(
        `slot ${slotIndex}: overlay.start_time_s=${start_time_s} < 0`,
      );
    }
    if (end_time_s > slot.target_duration_s) {
      throw new OverlayTimingError(
        `slot ${slotIndex}: overlay.end_time_s=${end_time_s} exceeds slot.target_duration_s=${slot.target_duration_s}`,
      );
    }
    if (entry.overlay.type !== 'none' && end_time_s <= start_time_s) {
      throw new OverlayTimingError(
        `slot ${slotIndex}: overlay.end_time_s=${end_time_s} <= start_time_s=${start_time_s} for non-none overlay`,
      );
    }
  }
}

function validateOverlayTextNull(pkg: CopyPackage): void {
  for (const entry of pkg.per_slot) {
    const { type, text } = entry.overlay;
    if (type === 'none') {
      if (text !== null) {
        throw new OverlayTextNullError(
          `slot ${entry.slot_id}: overlay.type='none' requires text=null; got text=${JSON.stringify(text)}`,
        );
      }
    } else {
      if (text === null || text.trim().length === 0) {
        throw new OverlayTextNullError(
          `slot ${entry.slot_id}: overlay.type='${type}' requires non-empty text; got text=${JSON.stringify(text)}`,
        );
      }
    }
  }
}

function validateHookDeliveryCoherence(pkg: CopyPackage): void {
  const { text, delivery, mechanism_tie } = pkg.hook;
  if (delivery === 'overlay' && text.length > 60) {
    throw new HookDeliveryCoherenceError(
      `hook.delivery='overlay' constrains text to ≤60 chars (screen-fit); got length=${text.length}`,
    );
  }
  if (delivery === 'spoken' || delivery === 'both') {
    const tieLower = mechanism_tie.toLowerCase();
    const mentionsVoice =
      tieLower.includes('voice') ||
      tieLower.includes('spoken') ||
      tieLower.includes('voiceover') ||
      tieLower.includes('narrat') ||
      tieLower.includes('audio') ||
      tieLower.includes('delivery') ||
      tieLower.includes('read') ||
      tieLower.includes('speak') ||
      tieLower.includes('say') ||
      tieLower.includes('direct-address') ||
      tieLower.includes('first sentence');
    if (!mentionsVoice) {
      throw new HookDeliveryCoherenceError(
        `hook.delivery='${delivery}' but mechanism_tie does not reference voice/narration pattern: ${JSON.stringify(mechanism_tie)}`,
      );
    }
  }
}

function validateCaptionSanity(pkg: CopyPackage): void {
  const { canonical, tiktok, instagram, youtube } = pkg.captions;
  if (tiktok.length > 150) {
    throw new CaptionSanityError(
      `captions.tiktok length=${tiktok.length} exceeds 150`,
    );
  }
  if (instagram.length > 2200) {
    throw new CaptionSanityError(
      `captions.instagram length=${instagram.length} exceeds 2200`,
    );
  }
  if (youtube.length > 5000) {
    throw new CaptionSanityError(
      `captions.youtube length=${youtube.length} exceeds 5000`,
    );
  }
  if (canonical.trim().length === 0) {
    throw new CaptionSanityError(`captions.canonical is empty`);
  }

  // Hashtag-as-hook preservation: if canonical carries a hashtag, the TikTok
  // trim must retain at least one (any hashtag, not the same one). This is
  // the most common drop-pattern when the model aggressively shortens TikTok.
  const canonicalHasHashtag = /#[a-zA-Z0-9_]+/.test(canonical);
  if (canonicalHasHashtag) {
    const tiktokHasHashtag = /#[a-zA-Z0-9_]+/.test(tiktok);
    if (!tiktokHasHashtag) {
      throw new CaptionSanityError(
        `captions.canonical contains a hashtag but captions.tiktok dropped all hashtags; hashtag-as-hook convention broken`,
      );
    }
  }
}

function validateHashtagFormat(pkg: CopyPackage): void {
  const seen = new Set<string>();
  for (const tag of pkg.hashtags) {
    if (tag !== tag.trim()) {
      throw new HashtagFormatError(`hashtag has leading/trailing whitespace: ${JSON.stringify(tag)}`);
    }
    const lower = tag.toLowerCase();
    if (seen.has(lower)) {
      throw new HashtagFormatError(`duplicate hashtag (case-insensitive): ${tag}`);
    }
    seen.add(lower);
  }
}

function validateOnScreenTextCollision(
  pkg: CopyPackage,
  picks: StoryboardPicks,
  snapshots: Map<string, CopywriterSegmentSnapshot>,
): void {
  const pickBySlotIndex = new Map(picks.picks.map((p) => [p.slot_index, p]));
  for (const entry of pkg.per_slot) {
    const slotIndex = parseSlotIndex(entry.slot_id);
    const pick = pickBySlotIndex.get(slotIndex);
    if (!pick) continue;
    const snap = snapshots.get(pick.picked_segment_id);
    if (!snap || !snap.setting.on_screen_text) continue;
    const ost = snap.setting.on_screen_text.trim();
    if (!ost) continue;
    const overlayText = entry.overlay.text;
    if (!overlayText) continue;
    if (overlayText.toLowerCase().includes(ost.toLowerCase())) {
      throw new OnScreenTextCollisionError(
        `slot ${slotIndex}: overlay.text ${JSON.stringify(overlayText)} contains snapshot.setting.on_screen_text ${JSON.stringify(ost)} as substring (case-insensitive)`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function parseSlotIndex(slotId: string): number {
  // Matches the slotIdFor() convention. If future work renames slot_ids, update
  // both places.
  const match = /^slot-(\d+)$/.exec(slotId);
  if (!match) {
    throw new OverlayTypeConstraintError(
      `slot_id ${JSON.stringify(slotId)} does not match the expected "slot-N" shape`,
    );
  }
  return Number(match[1]);
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

// Exposed for tests — emits the rendered prompt without calling Gemini.
export function renderPromptForTest(
  plannerOutput: PlannerOutput,
  picks: StoryboardPicks,
  persona: BrandPersona,
  snapshots: Map<string, CopywriterSegmentSnapshot>,
): string {
  return renderPrompt(plannerOutput, picks, persona, snapshots);
}

// Exposed for test scripts that want to vary model/temperature without
// mutating module state — kept simple intentionally; W8 orchestrator uses
// writeCopyForStoryboard directly.
export const COPYWRITER_V2_META = {
  model: COPYWRITER_MODEL,
  temperature: TEMPERATURE,
  max_output_tokens: MAX_OUTPUT_TOKENS,
} as const;

// Re-export slot_id convention for test scripts.
export { slotIdFor as slotIdForSlot };
