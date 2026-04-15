import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BrandConfig, CreativeBrief, BriefSegment } from '../types/database.js';
import type { VideoType } from '../types/video-types.js';
import { VIDEO_TYPE_CONFIGS, getAllowedVideoTypes } from '../types/video-types.js';
import { selectVideoType, getVideoTypeConfig } from '../lib/video-type-selector.js';
import { withLLMRetry } from '../lib/retry-llm.js';

const PROMPT_PATH = new URL('./prompts/creative-director-phase2.md', import.meta.url);

export interface CreativeDirectorInput {
  ideaSeed: string;
  brandConfig: BrandConfig;
}

/** Template mapping per video type */
const VIDEO_TYPE_TEMPLATE_MAP: Record<VideoType, string> = {
  'workout-demo': 'hook-demo-cta',
  'recipe-walkthrough': 'hook-demo-cta',
  'tips-listicle': 'hook-listicle-cta',
  'transformation': 'hook-transformation',
};

/** Load system prompt from markdown file */
async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, 'utf-8');
}

/** Call Claude API to generate a Creative Brief (requires ANTHROPIC_API_KEY) */
export async function generateBriefPhase2(input: CreativeDirectorInput): Promise<CreativeBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[creative-director] No ANTHROPIC_API_KEY — using mock mode');
    return generateMockBriefPhase2(input);
  }

  // Select video type before calling the agent
  const videoType = selectVideoType(input.brandConfig.brand_id, input.ideaSeed);
  const videoTypeConfig = getVideoTypeConfig(videoType);

  console.log(`[creative-director] Selected video type: ${videoType} for ${input.brandConfig.brand_id}`);

  const systemPrompt = await loadPrompt();

  const userMessage = JSON.stringify({
    idea_seed: input.ideaSeed,
    video_type: videoType,
    video_type_config: {
      description: videoTypeConfig.description,
      duration_range: videoTypeConfig.duration_range,
      pacing: videoTypeConfig.pacing,
      energy_curve: videoTypeConfig.energy_curve,
      music_energy_range: videoTypeConfig.music_energy_range,
      segments: videoTypeConfig.segments,
      transitions: videoTypeConfig.transitions,
      audio_strategy: videoTypeConfig.audio_strategy,
    },
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

  const data = await withLLMRetry(async () => {
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

    return (await response.json()) as { content: { type: string; text: string }[] };
  }, { label: 'creative-director' });
  const text = data.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('No text response from Claude');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  const raw = JSON.parse(jsonMatch[0]);
  return normalizeBrief(raw, input.brandConfig, videoType);
}

/** Normalize Claude's response to match our CreativeBrief interface exactly */
function normalizeBrief(raw: Record<string, unknown>, brandConfig: BrandConfig, expectedVideoType: VideoType): CreativeBrief {
  const segments = (raw.segments as Record<string, unknown>[]) ?? [];

  // Validate and normalize video_type
  const rawVideoType = String(raw.video_type ?? expectedVideoType);
  const allowedTypes = getAllowedVideoTypes(brandConfig.brand_id);
  const videoType: VideoType = allowedTypes.includes(rawVideoType as VideoType)
    ? (rawVideoType as VideoType)
    : expectedVideoType;

  const vtConfig = VIDEO_TYPE_CONFIGS[videoType];

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

    // Energy level from response, or fall back to video type's energy curve
    const energyLevel = Number(seg.energy_level ?? 0) || (vtConfig.energy_curve[i] ?? 5);

    // Pacing from response, or derive from video type's feel
    const rawPacing = String(seg.pacing ?? '').toLowerCase();
    let pacing: 'slow' | 'medium' | 'fast' = 'medium';
    if (rawPacing === 'slow' || rawPacing === 'fast') {
      pacing = rawPacing;
    } else if (vtConfig.pacing.feel === 'fast') {
      pacing = 'fast';
    } else if (vtConfig.pacing.feel === 'slow' || vtConfig.pacing.feel === 'building') {
      pacing = type === 'hook' ? 'slow' : 'medium';
    }

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
      label: seg.label ? String(seg.label) : undefined,
      duration_target: duration,
      energy_level: energyLevel,
      pacing,
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

  // Resolve template from video type
  const templateId = VIDEO_TYPE_TEMPLATE_MAP[videoType] ?? String(raw.template_id ?? 'hook-demo-cta');

  return {
    brief_id: (raw.brief_id && typeof raw.brief_id === 'string' && !raw.brief_id.includes('<')) ? raw.brief_id : randomUUID(),
    brand_id: String(raw.brand_id ?? brandConfig.brand_id),
    video_type: videoType,
    template_id: templateId,
    total_duration_target: Number(raw.total_duration_target ?? raw.video_duration ?? 45),
    segments: normalizedSegments,
    audio: raw.audio ? raw.audio as CreativeBrief['audio'] : {
      strategy: String((raw.audio_strategy as Record<string, unknown>)?.primary_audio ?? vtConfig.audio_strategy),
      background_music: {
        mood: String((raw.audio_strategy as Record<string, unknown>)?.music_style ?? 'upbeat'),
        volume_level: Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? (vtConfig.audio_strategy === 'music-primary' ? 0.30 : 0.15)) > 1
          ? Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? 0.30) / 100
          : Number((raw.audio_strategy as Record<string, unknown>)?.background_music_volume ?? (vtConfig.audio_strategy === 'music-primary' ? 0.30 : 0.15)),
      },
    },
    caption_preset: String(raw.caption_preset ?? brandConfig.caption_preset.preset_name),
  };
}

/** Mock brief for development — uses video type system */
export function generateMockBriefPhase2(input: CreativeDirectorInput): CreativeBrief {
  const briefId = randomUUID();
  const videoType = selectVideoType(input.brandConfig.brand_id, input.ideaSeed);
  const vtConfig = VIDEO_TYPE_CONFIGS[videoType];
  const templateId = VIDEO_TYPE_TEMPLATE_MAP[videoType];

  console.log(`[creative-director:mock] Selected video type: ${videoType}`);

  // Build segments from the video type's segment template
  const segments: BriefSegment[] = vtConfig.segments.map((segTemplate, i) => {
    const midDuration = Math.round((segTemplate.duration_range[0] + segTemplate.duration_range[1]) / 2);

    // Generate appropriate text overlay based on segment type and label
    let overlayText = '';
    if (segTemplate.type === 'hook') {
      overlayText = 'You need to try this!';
    } else if (segTemplate.type === 'cta') {
      overlayText = 'Try it free — link in bio';
    } else {
      overlayText = segTemplate.label.includes('tip')
        ? `${segTemplate.label.replace('tip-', '')}. Key insight here`
        : `${segTemplate.label.replace('-', ' ')} highlight`;
    }

    return {
      segment_id: i + 1,
      type: segTemplate.type,
      label: segTemplate.label,
      duration_target: midDuration,
      energy_level: segTemplate.energy,
      pacing: vtConfig.pacing.feel === 'fast' ? 'fast' as const
        : vtConfig.pacing.feel === 'slow' || vtConfig.pacing.feel === 'building' ? 'slow' as const
        : 'medium' as const,
      clip_requirements: {
        content_type: segTemplate.preferred_content_types,
        mood: segTemplate.energy >= 7 ? 'energetic' : segTemplate.energy <= 4 ? 'calm' : 'casual',
        visual_elements: ['person'],
        min_quality: 5,
        has_speech: segTemplate.expects_speech,
      },
      text_overlay: {
        text: overlayText,
        style: segTemplate.type === 'hook' ? 'bold-center' : segTemplate.type === 'cta' ? 'cta-bold' : 'subtitle',
        position: segTemplate.type === 'hook' || segTemplate.type === 'cta' ? 'center' : 'bottom',
        animation: segTemplate.type === 'hook' ? 'pop-in' : segTemplate.type === 'cta' ? 'slide-up' : undefined,
      },
    };
  });

  const totalDuration = segments.reduce((sum, s) => sum + s.duration_target, 0);

  return {
    brief_id: briefId,
    brand_id: input.brandConfig.brand_id,
    video_type: videoType,
    template_id: templateId,
    total_duration_target: totalDuration,
    segments,
    audio: {
      strategy: vtConfig.audio_strategy,
      background_music: {
        mood: vtConfig.music_energy_range[0] >= 7 ? 'energetic' : vtConfig.music_energy_range[0] >= 5 ? 'upbeat' : 'calm',
        volume_level: vtConfig.audio_strategy === 'music-primary' ? 0.30 : 0.15,
      },
    },
    caption_preset: input.brandConfig.caption_preset.preset_name,
  };
}
