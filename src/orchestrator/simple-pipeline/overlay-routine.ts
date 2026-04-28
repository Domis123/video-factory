/**
 * Overlay generator — routine path.
 *
 * Single short overlay text (4-15 words, label-style) for a routine video.
 * Reads brand_configs.voice_guidelines (Q1b: voice channel; aesthetic_description
 * is consumed by Match-Or-Match for visual reasoning, not by overlays).
 *
 * File: src/orchestrator/simple-pipeline/overlay-routine.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';

import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { withLLMRetry } from '../../lib/retry-llm.js';
import { computeGeminiCost } from '../../lib/llm-cost.js';

export interface OverlayRoutineInput {
  brandId: string;
  ideaSeed: string;
}

export interface OverlayResult {
  text: string;
  costUsd: number;
}

const MODEL_ID =
  process.env['GEMINI_OVERLAY_MODEL'] ||
  process.env['GEMINI_CURATOR_MODEL'] ||
  'gemini-2.5-pro';

const TEMPERATURE = 0.9; // Higher creativity for overlay copy variation

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '../../agents/prompts/overlay-routine.md'),
  'utf-8',
);

const MIN_WORDS = 4;
const MAX_WORDS = 15;

export async function generateRoutineOverlay(
  input: OverlayRoutineInput,
): Promise<OverlayResult> {
  if (!input.brandId.trim()) throw new Error('generateRoutineOverlay: brandId is required');
  if (!input.ideaSeed.trim()) throw new Error('generateRoutineOverlay: ideaSeed is required');

  const voiceGuidelines = await fetchVoiceGuidelines(input.brandId);
  const prompt = PROMPT_TEMPLATE
    .replace('{voice_guidelines}', voiceGuidelines)
    .replace('{idea_seed}', input.ideaSeed);

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const response = await withLLMRetry(
    () =>
      ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: TEMPERATURE },
      }),
    { label: 'overlay-routine', maxAttempts: 3 },
  );

  const raw = (response.text ?? '').trim();
  if (!raw) throw new Error('generateRoutineOverlay: Gemini returned empty text');

  const text = sanitizeOverlay(raw);
  validateWordCount(text, 'routine');

  const usage = computeGeminiCost(MODEL_ID, response);
  return { text, costUsd: usage.cost_usd };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchVoiceGuidelines(brandId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .select('voice_guidelines')
    .eq('brand_id', brandId)
    .single();
  if (error) {
    throw new Error(`overlay-routine: failed to fetch voice_guidelines for ${brandId}: ${error.message}`);
  }
  if (!data.voice_guidelines) {
    throw new Error(
      `overlay-routine: brand ${brandId} has no voice_guidelines. ` +
        `Populate brand_configs.voice_guidelines before invoking the overlay generator.`,
    );
  }
  return data.voice_guidelines;
}

/** Strip stray quotes / fences / trailing punctuation that the model sometimes adds. */
function sanitizeOverlay(raw: string): string {
  let t = raw.trim();
  // Drop wrapping quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  // Drop wrapping markdown emphasis
  t = t.replace(/^\*+|\*+$/g, '');
  // Routine: no trailing punctuation
  t = t.replace(/[.!?,;:]+$/g, '');
  return t.trim();
}

function validateWordCount(text: string, label: string): void {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
    throw new Error(
      `overlay-${label}: text has ${words.length} words, must be in [${MIN_WORDS}, ${MAX_WORDS}]. ` +
        `Text: "${text}"`,
    );
  }
}
