/**
 * Planner (W3) — picks a form + hook mechanism + slot structure for a given
 * idea seed, restricted by the brand's persona allowlist and informed by a
 * snapshot of the library inventory. Emits a structural brief only — no
 * overlay text (Copywriter, W7), no clip picks (Director, W5), no voiceover
 * (post-W10).
 *
 * Not wired into any running worker. W8 orchestrator is the first consumer;
 * W9 shadows. Importable + test-script-runnable at this workstream.
 *
 * File: src/agents/planner-v2.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { env } from '../config/env.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import { loadBrandPersona } from './brand-persona.js';
import { getLibraryInventory } from './library-inventory-v2.js';
import { PlannerOutputSchema, type PlannerOutput } from '../types/planner-output.js';
import type { BrandPersona } from '../types/brand-persona.js';
import type { LibraryInventory } from '../types/library-inventory.js';

const PLANNER_MODEL = process.env['GEMINI_PLANNER_MODEL'] || 'gemini-3.1-pro-preview';
const TEMPERATURE = 0.4;

const PROMPT_TEMPLATE = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, './prompts/planner-v2.md'),
  'utf-8',
);

// Gemini 3.1 Pro's `responseSchema` validator has a complexity budget —
// a schema with many enums + many min/max bounds + nested object arrays
// (which this one has) gets a blanket "INVALID_ARGUMENT" 400 with no field
// path. Individual constraint types all work in isolation; the rejection is
// emergent from constraint density. Empirical sweet spot: strip the *bounds*
// keywords (minimum/maximum/minLength/maxLength/minItems/maxItems) from the
// JSON schema we hand to Gemini. Enums + nullable + required stay — those
// are what drive structured output quality. Zod still enforces every bound
// at `.parse()` time post-generation, and the 2-attempt parse-retry loop
// below handles the occasional bound violation.
const RAW_PLANNER_JSON_SCHEMA = zodToJsonSchema(PlannerOutputSchema, {
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

const PLANNER_JSON_SCHEMA = stripSchemaBounds(RAW_PLANNER_JSON_SCHEMA) as Record<string, unknown>;

export interface PlannerInput {
  idea_seed: string;
  brand_id: string;
}

export async function planVideo(input: PlannerInput): Promise<PlannerOutput> {
  if (!input.idea_seed || !input.idea_seed.trim()) {
    throw new Error('planVideo: idea_seed is required');
  }
  if (!input.brand_id || !input.brand_id.trim()) {
    throw new Error('planVideo: brand_id is required');
  }

  const [persona, inventory] = await Promise.all([
    loadBrandPersona(input.brand_id),
    getLibraryInventory(input.brand_id),
  ]);

  const output = await callPlannerLLM(input.idea_seed, persona, inventory);
  validateSemantic(output, persona, input.brand_id);
  return output;
}

async function callPlannerLLM(
  ideaSeed: string,
  persona: BrandPersona,
  inventory: LibraryInventory,
): Promise<PlannerOutput> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const { prose_body: _prose, ...personaFrontmatter } = persona;

  const prompt = PROMPT_TEMPLATE
    .replace('{idea_seed}', ideaSeed)
    .replace('{persona_frontmatter_json}', JSON.stringify(personaFrontmatter, null, 2))
    .replace('{persona_prose}', persona.prose_body.trim())
    .replace('{library_inventory_json}', JSON.stringify(inventory, null, 2));

  const maxParseAttempts = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
    try {
      const response = await withLLMRetry(
        () =>
          ai.models.generateContent({
            model: PLANNER_MODEL,
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: PLANNER_JSON_SCHEMA as Record<string, unknown>,
              temperature: TEMPERATURE,
            },
          }),
        { label: 'planner-v2', maxAttempts: 3 },
      );

      const text = response.text ?? '';
      if (!text) throw new Error('Gemini Planner returned empty text');
      const raw = JSON.parse(text);
      return PlannerOutputSchema.parse(raw);
    } catch (err) {
      lastErr = err;
      const isParseErr =
        err instanceof z.ZodError || err instanceof SyntaxError;
      if (isParseErr && attempt < maxParseAttempts) {
        console.warn(
          `[planner-v2] attempt ${attempt} parse failed, retrying: ${messageOf(err)}`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('planner-v2 exhausted retries without a final error');
}

function validateSemantic(
  output: PlannerOutput,
  persona: BrandPersona,
  brandId: string,
): void {
  // 1. form_id must be a key in the persona's allowlist.
  const allowlist = persona.form_posture_allowlist;
  if (!(output.form_id in allowlist)) {
    const keys = Object.keys(allowlist).sort().join(', ');
    throw new Error(
      `Planner chose form '${output.form_id}' which is not in ${brandId}'s allowlist. Allowed: [${keys}].`,
    );
  }

  // 2. posture must be in the form's allowed postures.
  const allowedPostures = allowlist[output.form_id] ?? [];
  if (!allowedPostures.includes(output.posture)) {
    throw new Error(
      `Planner chose posture ${output.posture} for form ${output.form_id}, ` +
        `but persona only allows [${allowedPostures.join(', ')}] for this form.`,
    );
  }

  // 3. music_intent must not be in the persona's avoid list.
  if (persona.avoid_music_intents.includes(output.music_intent)) {
    throw new Error(
      `Planner chose music_intent '${output.music_intent}' which is in ${brandId}'s avoid_music_intents.`,
    );
  }

  // 4. Total slot duration cannot overflow (~30s target, 32s hard cap).
  const totalS = output.slots.reduce((a, s) => a + s.target_duration_s, 0);
  if (totalS > 32) {
    throw new Error(
      `Planner slot durations sum to ${totalS.toFixed(1)}s; max allowed is ~30s (hard cap 32s).`,
    );
  }

  // 5. slot_count must match slots.length.
  if (output.slot_count !== output.slots.length) {
    throw new Error(
      `slot_count=${output.slot_count} does not match slots array length ${output.slots.length}.`,
    );
  }

  // 6. audience_framing is microtutorial-only at W3.
  if (output.audience_framing !== null && output.form_id !== 'targeted_microtutorial') {
    throw new Error(
      `audience_framing is only valid for targeted_microtutorial at W3; got form_id=${output.form_id}, ` +
        `audience_framing=${JSON.stringify(output.audience_framing)}.`,
    );
  }
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
