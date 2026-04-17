import { readFile } from 'node:fs/promises';
import type { BrandConfig, CreativeBrief, CopyPackage, CopyOverlay, BriefSegment, Phase3CreativeBrief, Phase3BriefSegment } from '../types/database.js';
import { withLLMRetry } from '../lib/retry-llm.js';

const PROMPT_PATH = new URL('./prompts/copywriter.md', import.meta.url);

export interface CopywriterInput {
  brief: CreativeBrief | Phase3CreativeBrief;
  brandConfig: BrandConfig;
}

/** Load system prompt from markdown file */
async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, 'utf-8');
}

/** Call Claude API to generate copy (requires ANTHROPIC_API_KEY) */
export async function generateCopy(input: CopywriterInput): Promise<CopyPackage> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[copywriter] No ANTHROPIC_API_KEY — using mock mode');
    return generateMockCopy(input);
  }

  const systemPrompt = await loadPrompt();

  const isPhase3 = 'creative_direction' in input.brief;
  let userMessage: string;

  if (isPhase3) {
    const p3 = input.brief as Phase3CreativeBrief;
    userMessage = buildPhase3UserMessage(p3, input.brandConfig);
    console.log(`[copywriter] Phase 3 brief: ${p3.segments.length} slots, vision="${p3.creative_direction.creative_vision.slice(0, 60)}..."`);
  } else {
    userMessage = JSON.stringify({
      brief: input.brief,
      brand: {
        brand_id: input.brandConfig.brand_id,
        brand_name: input.brandConfig.brand_name,
        voice_guidelines: input.brandConfig.voice_guidelines,
        hook_style_preference: input.brandConfig.hook_style_preference,
        content_pillars: input.brandConfig.content_pillars,
        cta_style: input.brandConfig.cta_style,
      },
    });
  }

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
  }, { label: 'copywriter' });
  const text = data.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('No text response from Claude');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  const raw = JSON.parse(jsonMatch[0]);
  return normalizeCopy(raw, input.brief.brief_id);
}

function buildPhase3UserMessage(brief: Phase3CreativeBrief, brandConfig: BrandConfig): string {
  const lines: string[] = [];

  lines.push('=== PHASE 3 BRIEF ===');
  lines.push('');
  lines.push(`CREATIVE VISION: ${brief.creative_direction.creative_vision}`);
  lines.push(`VIDEO TYPE: ${brief.video_type}`);
  lines.push(`TOTAL DURATION: ${brief.total_duration_target}s`);
  lines.push(`COLOR TREATMENT: ${brief.creative_direction.color_treatment}`);
  lines.push('');
  lines.push('--- PER-SLOT TEXT OVERLAY CONSTRAINTS ---');

  for (let i = 0; i < brief.segments.length; i++) {
    const seg = brief.segments[i];
    const clipCtx = [seg.clip_requirements.mood, ...seg.clip_requirements.visual_elements].join(', ');
    lines.push(
      `Slot ${i} (${seg.type}${seg.label ? `, ${seg.label}` : ''}): ` +
      `style=${seg.text_overlay.style}, position=${seg.text_overlay.position}, ` +
      `char_target=${seg.text_overlay.char_target}, animation=${seg.text_overlay.animation}. ` +
      `Clip context: ${clipCtx}`,
    );
  }

  lines.push('');
  lines.push('--- BRAND ---');
  lines.push(JSON.stringify({
    brand_id: brandConfig.brand_id,
    brand_name: brandConfig.brand_name,
    voice_guidelines: brandConfig.voice_guidelines,
    hook_style_preference: brandConfig.hook_style_preference,
    content_pillars: brandConfig.content_pillars,
    cta_style: brandConfig.cta_style,
  }));

  lines.push('');
  lines.push('--- FULL BRIEF (reference) ---');
  lines.push(JSON.stringify(brief));

  return lines.join('\n');
}

/** Normalize Claude's response to match our CopyPackage interface */
function normalizeCopy(raw: Record<string, unknown>, briefId: string): CopyPackage {
  // Normalize overlays
  const rawOverlays = (raw.overlays ?? []) as Record<string, unknown>[];
  const overlays: CopyOverlay[] = rawOverlays.map((ov) => {
    const overlay: CopyOverlay = { segment_id: Number(ov.segment_id ?? 0) };

    if (Array.isArray(ov.sub_overlays) && ov.sub_overlays.length > 0) {
      overlay.sub_overlays = (ov.sub_overlays as Record<string, unknown>[]).map((sub) => ({
        text: String(sub.text ?? ''),
        char_count: Number(sub.char_count ?? String(sub.text ?? '').length),
        timing: sub.timing as { appear_s: number; duration_s: number },
      }));
    } else {
      overlay.text = ov.text ? String(ov.text) : undefined;
      overlay.char_count = ov.char_count ? Number(ov.char_count) : (ov.text ? String(ov.text).length : undefined);
      overlay.timing = ov.timing as { appear_s: number; duration_s: number } | undefined;
    }

    return overlay;
  });

  // Normalize captions
  const captions = (raw.captions ?? {}) as Record<string, string>;

  // Normalize hashtags
  const hashtags = (raw.hashtags ?? {}) as Record<string, string[]>;

  // Normalize hook variants
  const hookVariants = ((raw.hook_variants ?? []) as Record<string, unknown>[]).map((h) => ({
    text: String(h.text ?? ''),
    style: String(h.style ?? 'curiosity'),
  }));

  return {
    brief_id: String(raw.brief_id ?? briefId),
    overlays,
    captions: {
      tiktok: captions.tiktok ?? '',
      instagram: captions.instagram ?? '',
      youtube: captions.youtube ?? '',
    },
    hashtags: {
      tiktok: hashtags.tiktok ?? [],
      instagram: hashtags.instagram ?? [],
      youtube: hashtags.youtube ?? [],
    },
    hook_variants: hookVariants,
  };
}

/** Mock copy for development */
export function generateMockCopy(input: CopywriterInput): CopyPackage {
  const isPhase3 = 'creative_direction' in input.brief;
  const brandName = input.brandConfig.brand_name;

  let overlays: CopyOverlay[];

  if (isPhase3) {
    const p3 = input.brief as Phase3CreativeBrief;
    let timeOffset = 0;
    overlays = p3.segments.map((seg: Phase3BriefSegment, i: number) => {
      const mockText = seg.text_overlay.style === 'none' ? '' : `Mock ${seg.type} text`;
      const overlay: CopyOverlay = {
        segment_id: i,
        text: mockText,
        char_count: mockText.length,
        timing: { appear_s: timeOffset, duration_s: seg.cut_duration_target_s },
      };
      timeOffset += seg.cut_duration_target_s;
      return overlay;
    });
  } else {
    const p2 = input.brief as CreativeBrief;
    let timeOffset = 0;
    overlays = p2.segments.map((seg: BriefSegment) => {
      const overlay: CopyOverlay = { segment_id: seg.segment_id };

      if (seg.sub_segments) {
        overlay.sub_overlays = seg.sub_segments.map((sub) => {
          const appear = timeOffset;
          timeOffset += sub.duration;
          return {
            text: sub.text_overlay.text,
            char_count: sub.text_overlay.text.length,
            timing: { appear_s: appear, duration_s: sub.duration },
          };
        });
      } else {
        overlay.text = seg.text_overlay.text;
        overlay.char_count = seg.text_overlay.text.length;
        overlay.timing = { appear_s: timeOffset, duration_s: seg.duration_target };
        timeOffset += seg.duration_target;
      }

      return overlay;
    });
  }

  return {
    brief_id: input.brief.brief_id,
    overlays,
    captions: {
      tiktok: `This changed everything for me #${brandName.toLowerCase().replace(/\s/g, '')}`,
      instagram: `We tried something new and the results speak for themselves. What do you think?\n\n#${brandName.toLowerCase().replace(/\s/g, '')} #wellness #lifestyle`,
      youtube: `How ${brandName} Changed My Daily Routine`,
    },
    hashtags: {
      tiktok: ['#fyp', '#viral', `#${brandName.toLowerCase().replace(/\s/g, '')}`, '#trending', '#lifestyle'],
      instagram: [`#${brandName.toLowerCase().replace(/\s/g, '')}`, '#wellness', '#selfcare', '#lifestyle', '#health', '#dailyroutine'],
      youtube: [`#${brandName.toLowerCase().replace(/\s/g, '')}`, '#shorts', '#lifestyle', '#wellness', '#results'],
    },
    hook_variants: [
      { text: 'You NEED to try this', style: 'curiosity' },
      { text: 'Nobody talks about this enough', style: 'controversy' },
      { text: 'I wish I knew this sooner', style: 'fomo' },
    ],
  };
}
