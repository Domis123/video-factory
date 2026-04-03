import { readFile } from 'node:fs/promises';
import { supabaseAdmin } from '../config/supabase.js';
import type { Asset, CreativeBrief, ClipSelectionList, ClipSelection, BriefSegment } from '../types/database.js';

const PROMPT_PATH = new URL('./prompts/asset-curator.md', import.meta.url);

export interface AssetCuratorInput {
  brief: CreativeBrief;
}

/** Load system prompt from markdown file */
async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, 'utf-8');
}

/** Fetch candidate assets from Supabase for a brand */
async function fetchCandidateAssets(brandId: string): Promise<Asset[]> {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('brand_id', brandId)
    .order('quality_score', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to fetch assets: ${error.message}`);
  return (data ?? []) as Asset[];
}

/** Call Claude API to select clips (requires ANTHROPIC_API_KEY) */
export async function selectClips(input: AssetCuratorInput): Promise<ClipSelectionList> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[asset-curator] No ANTHROPIC_API_KEY — using mock mode');
    return selectMockClips(input);
  }

  const assets = await fetchCandidateAssets(input.brief.brand_id);
  if (assets.length === 0) {
    console.warn('[asset-curator] No assets found — using mock mode');
    return selectMockClips(input);
  }

  const systemPrompt = await loadPrompt();

  const userMessage = JSON.stringify({
    brief: input.brief,
    available_assets: assets.map((a) => ({
      id: a.id,
      r2_key: a.r2_key,
      content_type: a.content_type,
      mood: a.mood,
      quality_score: a.quality_score,
      duration_seconds: a.duration_seconds,
      has_speech: a.has_speech,
      visual_elements: a.visual_elements,
      usable_segments: a.usable_segments,
      used_count: a.used_count,
      tags: a.tags,
    })),
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

  return JSON.parse(jsonMatch[0]) as ClipSelectionList;
}

/** Mock clip selection for development */
export function selectMockClips(input: AssetCuratorInput): ClipSelectionList {
  const selections: ClipSelection[] = input.brief.segments.map((seg: BriefSegment) => {
    if (seg.type === 'body' && seg.sub_segments) {
      // Multi-clip body segment
      return {
        segment_id: seg.segment_id,
        clips: seg.sub_segments.map((sub, i) => ({
          asset_id: `mock-asset-${seg.segment_id}-${i + 1}`,
          r2_key: `assets/${input.brief.brand_id}/mock-clip-${seg.segment_id}-${i + 1}.mp4`,
          trim: { start_s: 0, end_s: sub.duration },
        })),
        match_score: 0.85,
        match_rationale: `Mock: ${seg.sub_segments.length} clips for body segment`,
      };
    }

    return {
      segment_id: seg.segment_id,
      asset_id: `mock-asset-${seg.segment_id}`,
      r2_key: `assets/${input.brief.brand_id}/mock-clip-${seg.segment_id}.mp4`,
      trim: { start_s: 0, end_s: seg.duration_target },
      match_score: 0.9,
      match_rationale: `Mock: best match for ${seg.type} segment`,
    };
  });

  return {
    brief_id: input.brief.brief_id,
    clip_selections: selections,
  };
}
