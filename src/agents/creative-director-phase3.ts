import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { BrandConfig, Phase3CreativeBrief } from '../types/database.js';
import { validatePhase3Brief } from './creative-director-phase3-schema.js';
import { withLLMRetry } from '../lib/retry-llm.js';

const PROMPT_PATH = new URL('./prompts/creative-director.md', import.meta.url);
const MODEL_ID = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

export interface CreativeDirectorPhase3Input {
  ideaSeed: string;
  brandConfig: BrandConfig;
  // vibe deferred per W1 Step 0 — added as optional field when S1/sheet ships
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Per-call diagnostics for the last invocation of `generateBriefPhase3`.
 * Reset at the start of each call. Read by smoke tests / dev tooling —
 * not intended for production flow control.
 */
export interface LastGenerationStats {
  firstAttemptOk: boolean;
  correctiveAttempted: boolean;
  inputTokens: number;
  outputTokens: number;
}

export let lastGenerationStats: LastGenerationStats = {
  firstAttemptOk: false,
  correctiveAttempted: false,
  inputTokens: 0,
  outputTokens: 0,
};

async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, 'utf-8');
}

function buildUserMessage(input: CreativeDirectorPhase3Input): string {
  return JSON.stringify({
    idea_seed: input.ideaSeed,
    brand_config: {
      brand_id: input.brandConfig.brand_id,
      brand_name: input.brandConfig.brand_name,
      content_pillars: input.brandConfig.content_pillars,
      voice_guidelines: input.brandConfig.voice_guidelines,
      allowed_video_types: input.brandConfig.allowed_video_types,
      allowed_color_treatments: input.brandConfig.allowed_color_treatments,
      caption_preset: input.brandConfig.caption_preset.preset_name,
    },
  });
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: ClaudeMessage[],
  label: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const data = await withLLMRetry(async () => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const error = new Error(`Claude API error ${response.status}: ${errText}`) as Error & {
        status: number;
        error?: { type: string };
      };
      error.status = response.status;
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.type) error.error = { type: parsed.error.type };
      } catch {
        /* body wasn't JSON, ignore */
      }
      throw error;
    }

    return (await response.json()) as ClaudeResponse;
  }, { label });

  const text = data.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('No text response from Claude');
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in Claude response: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

function formatZodErrors(err: ZodError): string {
  return err.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

function buildCorrectiveMessage(err: ZodError, firstJson: unknown): string {
  return (
    `Your previous response failed schema validation:\n\n` +
    `<errors>\n${formatZodErrors(err)}\n</errors>\n\n` +
    `Your previous JSON:\n${JSON.stringify(firstJson)}\n\n` +
    `Re-emit the brief as a single JSON object that fixes ALL the issues above. ` +
    `Do not explain — output JSON only.`
  );
}

/**
 * Generate a Phase 3 Creative Brief.
 *
 * On schema-validation failure, sends the Zod errors back for ONE corrective retry.
 * If the corrective attempt also fails, throws. No silent coercion — invalid briefs
 * should surface, not be patched over.
 */
export async function generateBriefPhase3(
  input: CreativeDirectorPhase3Input,
): Promise<Phase3CreativeBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[creative-director-phase3] No ANTHROPIC_API_KEY — using mock mode');
    return generateMockBriefPhase3(input);
  }

  const systemPrompt = await loadPrompt();
  const userMessage = buildUserMessage(input);

  console.log(`[creative-director-phase3] Generating brief for ${input.brandConfig.brand_id}...`);

  // Reset per-call instrumentation
  lastGenerationStats = {
    firstAttemptOk: false,
    correctiveAttempted: false,
    inputTokens: 0,
    outputTokens: 0,
  };

  const firstCall = await callClaude(
    apiKey,
    systemPrompt,
    [{ role: 'user', content: userMessage }],
    'creative-director-phase3',
  );
  lastGenerationStats.inputTokens += firstCall.inputTokens;
  lastGenerationStats.outputTokens += firstCall.outputTokens;

  const firstJson = extractJson(firstCall.text);

  // Ensure brief_id is a real UUID — prompt's example uses a placeholder
  const withBriefId = ensureBriefId(firstJson, input);

  try {
    const brief = validatePhase3Brief(withBriefId);
    lastGenerationStats.firstAttemptOk = true;
    return brief;
  } catch (zodErr) {
    if (!(zodErr instanceof ZodError)) throw zodErr;

    console.warn(
      `[creative-director-phase3] Initial Zod validation failed, attempting corrective retry:\n${formatZodErrors(zodErr)}`,
    );
    lastGenerationStats.correctiveAttempted = true;

    const correctiveCall = await callClaude(
      apiKey,
      systemPrompt,
      [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: JSON.stringify(firstJson) },
        { role: 'user', content: buildCorrectiveMessage(zodErr, firstJson) },
      ],
      'creative-director-phase3-corrective',
    );
    lastGenerationStats.inputTokens += correctiveCall.inputTokens;
    lastGenerationStats.outputTokens += correctiveCall.outputTokens;

    const secondJson = extractJson(correctiveCall.text);
    const secondWithBriefId = ensureBriefId(secondJson, input);

    try {
      const brief = validatePhase3Brief(secondWithBriefId);
      console.log('[creative-director-phase3] Corrective retry succeeded');
      return brief;
    } catch (secondErr) {
      if (secondErr instanceof ZodError) {
        console.error(
          `[creative-director-phase3] Corrective retry also failed:\n${formatZodErrors(secondErr)}`,
        );
      }
      throw secondErr;
    }
  }
}

function ensureBriefId(raw: unknown, input: CreativeDirectorPhase3Input): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const existing = obj.brief_id;
  const isPlaceholder =
    typeof existing !== 'string' ||
    existing.length === 0 ||
    existing.includes('<') ||
    existing.startsWith('will be set');
  if (isPlaceholder) obj.brief_id = randomUUID();
  // Same treatment for brand_id echo — guard against the model emitting a placeholder
  if (typeof obj.brand_id !== 'string' || obj.brand_id.includes('<')) {
    obj.brand_id = input.brandConfig.brand_id;
  }
  return obj;
}

/**
 * Hardcoded valid Phase 3 brief for offline testing. Matches the schema exactly.
 * Mirrors Example 1 from the Phase 3 prompt (calm-instructional workout-demo).
 */
export function generateMockBriefPhase3(
  input: CreativeDirectorPhase3Input,
): Phase3CreativeBrief {
  return {
    brief_id: randomUUID(),
    brand_id: input.brandConfig.brand_id,
    video_type: 'workout-demo',
    composition_id: 'phase3-parameterized-v1',
    total_duration_target: 38,
    caption_preset: input.brandConfig.caption_preset.preset_name,
    idea_seed: input.ideaSeed,
    vibe: 'grounded, gentle, studio-warm',
    creative_direction: {
      creative_vision:
        'A calm, approachable routine for mock testing. Warm studio light, deliberate movement, one exercise at a time.',
      slot_count: 5,
      energy_per_slot: [7, 5, 6, 6, 5],
      color_treatment: 'warm-vibrant',
    },
    segments: [
      {
        type: 'hook',
        label: 'hook-question',
        pacing: 'medium',
        cut_duration_target_s: 3,
        transition_in: 'hard-cut',
        internal_cut_style: 'hold',
        text_overlay: { style: 'bold-center', position: 'center', animation: 'pop-in', char_target: 38 },
        clip_requirements: {
          mood: 'inviting',
          has_speech: true,
          min_quality: 7,
          content_type: ['talking-head'],
          visual_elements: ['person', 'studio'],
          aesthetic_guidance: 'Instructor facing camera in a bright studio, warm natural light.',
        },
      },
      {
        type: 'body',
        label: 'move-1',
        pacing: 'slow',
        cut_duration_target_s: 9,
        transition_in: 'crossfade',
        internal_cut_style: 'hold',
        text_overlay: { style: 'label', position: 'top-left', animation: 'fade', char_target: 22 },
        clip_requirements: {
          mood: 'focused',
          has_speech: false,
          min_quality: 6,
          content_type: ['exercise'],
          visual_elements: ['person', 'mat'],
          aesthetic_guidance: 'Side-angle view of a controlled movement, full body visible.',
        },
      },
      {
        type: 'body',
        label: 'move-2',
        pacing: 'slow',
        cut_duration_target_s: 9,
        transition_in: 'crossfade',
        internal_cut_style: 'hold',
        text_overlay: { style: 'label', position: 'top-left', animation: 'fade', char_target: 22 },
        clip_requirements: {
          mood: 'focused',
          has_speech: false,
          min_quality: 6,
          content_type: ['exercise'],
          visual_elements: ['person', 'mat'],
          aesthetic_guidance: 'Mat-level view with emphasis on form, slow breath-synced movement.',
        },
      },
      {
        type: 'body',
        label: 'move-3',
        pacing: 'slow',
        cut_duration_target_s: 9,
        transition_in: 'crossfade',
        internal_cut_style: 'hold',
        text_overlay: { style: 'label', position: 'top-left', animation: 'fade', char_target: 22 },
        clip_requirements: {
          mood: 'focused',
          has_speech: false,
          min_quality: 6,
          content_type: ['exercise'],
          visual_elements: ['person', 'mat'],
          aesthetic_guidance: 'Side view with calm tempo and controlled descent.',
        },
      },
      {
        type: 'cta',
        label: 'cta-follow',
        pacing: 'medium',
        cut_duration_target_s: 8,
        transition_in: 'fade-from-black',
        internal_cut_style: 'hold',
        text_overlay: { style: 'cta', position: 'center', animation: 'slide-up', char_target: 32 },
        clip_requirements: {
          mood: 'warm',
          has_speech: true,
          min_quality: 7,
          content_type: ['talking-head', 'lifestyle'],
          visual_elements: ['person'],
          aesthetic_guidance: 'Instructor smiling to camera, softer lighting, closing invitation energy.',
        },
      },
    ],
    audio: {
      strategy: 'music-primary',
      music: {
        mood: 'meditative',
        tempo: 'slow',
        energy_level: 4,
        volume_level: 0.22,
        pinned_track_id: null,
      },
    },
  };
}
