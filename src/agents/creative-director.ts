import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BrandConfig, CreativeBrief, BriefSegment } from '../types/database.js';

const PROMPT_PATH = new URL('./prompts/creative-director.md', import.meta.url);

export interface CreativeDirectorInput {
  ideaSeed: string;
  brandConfig: BrandConfig;
}

/** Load system prompt from markdown file */
async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, 'utf-8');
}

/** Call Claude API to generate a Creative Brief (requires ANTHROPIC_API_KEY) */
export async function generateBrief(input: CreativeDirectorInput): Promise<CreativeBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[creative-director] No ANTHROPIC_API_KEY — using mock mode');
    return generateMockBrief(input);
  }

  const systemPrompt = await loadPrompt();

  const userMessage = JSON.stringify({
    idea_seed: input.ideaSeed,
    brand_config: {
      brand_id: input.brandConfig.brand_id,
      brand_name: input.brandConfig.brand_name,
      content_pillars: input.brandConfig.content_pillars,
      hook_style_preference: input.brandConfig.hook_style_preference,
      voice_guidelines: input.brandConfig.voice_guidelines,
      cta_style: input.brandConfig.cta_style,
      transition_style: input.brandConfig.transition_style,
      caption_preset: input.brandConfig.caption_preset.preset_name,
    },
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { content: { type: string; text: string }[] };
  const text = data.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('No text response from Claude');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  const raw = JSON.parse(jsonMatch[0]);
  return normalizeBrief(raw, input.brandConfig);
}

/** Normalize Claude's response to match our CreativeBrief interface exactly */
function normalizeBrief(raw: Record<string, unknown>, brandConfig: BrandConfig): CreativeBrief {
  const segments = (raw.segments as Record<string, unknown>[]) ?? [];

  const normalizedSegments: BriefSegment[] = segments.map((seg, i) => {
    // Normalize segment type
    const rawType = String(seg.type ?? seg.segment_id ?? '').toLowerCase();
    let type: 'hook' | 'body' | 'cta' = 'body';
    if (rawType.includes('hook')) type = 'hook';
    else if (rawType.includes('cta')) type = 'cta';

    // Normalize clip_requirements
    const cr = (seg.clip_requirements ?? {}) as Record<string, unknown>;
    const contentType = Array.isArray(cr.content_type) ? cr.content_type : [String(cr.content_type ?? 'lifestyle')];
    const mood = Array.isArray(cr.mood) ? cr.mood[0] : String(cr.mood ?? 'casual');

    // Normalize text_overlay — Claude might return text_overlays array
    let textOverlay: { text: string; style: string; position: string; animation?: string };
    const overlays = seg.text_overlays ?? seg.text_overlay;
    if (Array.isArray(overlays)) {
      const first = overlays[0] as Record<string, unknown>;
      textOverlay = {
        text: String(first?.text ?? ''),
        style: String(first?.style ?? 'subtitle'),
        position: String(first?.position ?? 'bottom'),
        animation: first?.animation ? String(first.animation) : undefined,
      };
    } else if (overlays && typeof overlays === 'object') {
      const ov = overlays as Record<string, unknown>;
      textOverlay = {
        text: String(ov.text ?? ''),
        style: String(ov.style ?? 'subtitle'),
        position: String(ov.position ?? 'bottom'),
        animation: ov.animation ? String(ov.animation) : undefined,
      };
    } else {
      textOverlay = { text: '', style: 'subtitle', position: 'bottom' };
    }

    // Duration: use duration_target, or compute from start/end times
    const duration = Number(seg.duration_target ?? 0) ||
      (Number(seg.end_time ?? 0) - Number(seg.start_time ?? 0)) || 5;

    // Build sub_segments from text_overlays array if body segment has multiple overlays
    let subSegments: BriefSegment['sub_segments'];
    if (type === 'body' && Array.isArray(seg.text_overlays) && (seg.text_overlays as unknown[]).length > 1) {
      subSegments = (seg.text_overlays as Record<string, unknown>[]).map((ov) => ({
        duration: Number(ov.end_time ?? 0) - Number(ov.start_time ?? 0) || Math.floor(duration / (seg.text_overlays as unknown[]).length),
        text_overlay: {
          text: String(ov.text ?? ''),
          style: String(ov.style ?? 'subtitle'),
        },
      }));
    } else {
      subSegments = seg.sub_segments as BriefSegment['sub_segments'];
    }

    return {
      segment_id: Number(seg.segment_id) || (i + 1),
      type,
      duration_target: duration,
      clip_requirements: {
        content_type: contentType.map(String),
        mood,
        visual_elements: Array.isArray(cr.visual_elements) ? cr.visual_elements.map(String) : undefined,
        min_quality: Number(cr.min_quality ?? cr.minimum_quality) || undefined,
        has_speech: cr.has_speech as boolean | undefined,
      },
      text_overlay: textOverlay,
      sub_segments: subSegments,
    };
  });

  return {
    brief_id: (raw.brief_id && typeof raw.brief_id === 'string' && !raw.brief_id.includes('<')) ? raw.brief_id : randomUUID(),
    brand_id: String(raw.brand_id ?? brandConfig.brand_id),
    template_id: String(raw.template_id ?? raw.template ?? 'hook-demo-cta'),
    total_duration_target: Number(raw.total_duration_target ?? raw.video_duration ?? 45),
    segments: normalizedSegments,
    audio: raw.audio ? raw.audio as CreativeBrief['audio'] : {
      strategy: String((raw.audio_strategy as Record<string, unknown>)?.primary_audio ?? 'ugc-primary'),
      background_music: {
        mood: String((raw.audio_strategy as Record<string, unknown>)?.music_style ?? 'upbeat'),
        volume_level: Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? 15) > 1
          ? Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? 15) / 100
          : Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? 0.15),
      },
    },
    caption_preset: String(raw.caption_preset ?? brandConfig.caption_preset.preset_name),
  };
}

/** Mock brief for development — no API call needed */
export function generateMockBrief(input: CreativeDirectorInput): CreativeBrief {
  const briefId = randomUUID();

  return {
    brief_id: briefId,
    brand_id: input.brandConfig.brand_id,
    template_id: 'hook-demo-cta',
    total_duration_target: 35,
    segments: [
      {
        segment_id: 1,
        type: 'hook',
        duration_target: 3,
        clip_requirements: {
          content_type: ['lifestyle', 'talking-head'],
          mood: 'energetic',
          visual_elements: ['person'],
          min_quality: 6,
          has_speech: true,
        },
        text_overlay: {
          text: 'You need to try this!',
          style: 'bold-center',
          position: 'center',
          animation: 'pop-in',
        },
      },
      {
        segment_id: 2,
        type: 'body',
        duration_target: 25,
        clip_requirements: {
          content_type: ['product-demo', 'lifestyle'],
          mood: ['casual', 'aspirational'],
          visual_elements: ['product', 'person'],
          min_quality: 5,
        },
        text_overlay: {
          text: 'Here\'s what changed everything',
          style: 'subtitle',
          position: 'bottom',
        },
        sub_segments: [
          { duration: 8, text_overlay: { text: 'Step 1: Start simple', style: 'subtitle' } },
          { duration: 8, text_overlay: { text: 'Step 2: Stay consistent', style: 'subtitle' } },
          { duration: 9, text_overlay: { text: 'Step 3: See results', style: 'subtitle' } },
        ],
      },
      {
        segment_id: 3,
        type: 'cta',
        duration_target: 5,
        clip_requirements: {
          content_type: ['lifestyle'],
          mood: 'uplifting',
          min_quality: 5,
        },
        text_overlay: {
          text: 'Try it free — link in bio',
          style: 'cta-bold',
          position: 'center',
          animation: 'slide-up',
        },
      },
    ],
    audio: {
      strategy: 'ugc-primary',
      background_music: {
        mood: 'upbeat',
        volume_level: 0.15,
      },
    },
    caption_preset: input.brandConfig.caption_preset.preset_name,
  };
}
