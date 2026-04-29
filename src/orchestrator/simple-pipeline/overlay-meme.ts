/**
 * Overlay generator — meme path.
 *
 * Single short overlay text (4-12 words, hook/meme-style) for a single-clip
 * meme video. Reads brand_configs.voice_guidelines (Q1b: voice channel;
 * aesthetic_description is consumed by Match-Or-Match for visual reasoning,
 * not by overlays).
 *
 * Trailing punctuation policy is the only meaningful difference from the
 * routine overlay: meme allows one trailing ! or ?; routine strips all
 * trailing punctuation. Word count band is also tighter (4-12 vs 4-15).
 *
 * File: src/orchestrator/simple-pipeline/overlay-meme.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';

import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { withLLMRetry } from '../../lib/retry-llm.js';
import { computeGeminiCost } from '../../lib/llm-cost.js';

export interface OverlayMemeInput {
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

const TEMPERATURE = 1.0; // Higher still — meme overlays benefit from more creative latitude

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '../../agents/prompts/overlay-meme.md'),
  'utf-8',
);

// Meme captions sometimes land at 3 words ("it's giving tuesday", "soft
// girl era") — the Round 2 prompt rewrite explicitly targets the seed's
// register, which can be very tight. Lowering the floor from 4 to 3 lets
// these tight captions through; below 3 words is almost always too thin
// to read as caption (single-token outputs etc.).
const MIN_WORDS = 3;
const MAX_WORDS = 12;

export async function generateMemeOverlay(input: OverlayMemeInput): Promise<OverlayResult> {
  if (!input.brandId.trim()) throw new Error('generateMemeOverlay: brandId is required');
  if (!input.ideaSeed.trim()) throw new Error('generateMemeOverlay: ideaSeed is required');

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
    { label: 'overlay-meme', maxAttempts: 3 },
  );

  const raw = (response.text ?? '').trim();
  if (!raw) throw new Error('generateMemeOverlay: Gemini returned empty text');

  const text = sanitizeOverlay(raw);
  validateWordCount(text, 'meme');

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
    throw new Error(`overlay-meme: failed to fetch voice_guidelines for ${brandId}: ${error.message}`);
  }
  if (!data.voice_guidelines) {
    throw new Error(
      `overlay-meme: brand ${brandId} has no voice_guidelines. ` +
        `Populate brand_configs.voice_guidelines before invoking the overlay generator.`,
    );
  }
  return data.voice_guidelines;
}

/** Strip stray quotes / fences. Allow ONE trailing ! or ?, strip everything else. */
function sanitizeOverlay(raw: string): string {
  let t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  t = t.replace(/^\*+|\*+$/g, '');
  // Strip stacked punctuation like "..." but preserve a single ! or ?
  t = t.replace(/[.,;:]+$/g, '');
  t = t.replace(/([!?])[!?]+$/g, '$1');
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
