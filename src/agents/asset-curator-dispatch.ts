import type { AssetCuratorInput } from './asset-curator.js';
import { selectClips } from './asset-curator.js';
import { curateWithV2, type CuratorV2Brief } from './asset-curator-v2.js';
import type { ClipSelectionList, ClipSelection, BriefSegment } from '../types/database.js';
import type { BriefSlot } from './curator-v2-retrieval.js';

/**
 * Flag-gated curator dispatcher. Reads ENABLE_CURATOR_V2 from process.env
 * on every call (not cached — flag is live-flippable).
 *
 * V2 output is reshaped to match V1's ClipSelectionList so pipeline.ts
 * doesn't need to change.
 */
export async function curateAssets(
  input: AssetCuratorInput,
  brandId: string,
): Promise<ClipSelectionList> {
  const useV2 = process.env['ENABLE_CURATOR_V2'] === 'true';

  if (!useV2) {
    console.log('[curator-dispatch] Using V1 (Sonnet text-based)');
    return selectClips(input);
  }

  console.log('[curator-dispatch] Using V2 (Gemini Pro + vector retrieval)');

  // Build V2 brief from V1's CreativeBrief segments
  const v2Brief: CuratorV2Brief = {
    brandId,
    slots: input.brief.segments.map((seg: BriefSegment): BriefSlot => ({
      index: seg.segment_id,
      description: buildSlotDescription(seg),
      valid_segment_types: mapContentTypesToSegmentTypes(seg),
      min_quality: seg.clip_requirements.min_quality ?? 5,
    })),
  };

  const v2Results = await curateWithV2(v2Brief);

  // Reshape V2 results to V1 ClipSelectionList
  const clipSelections: ClipSelection[] = v2Results.map((r) => ({
    segment_id: r.slotIndex,
    asset_id: r.parentAssetId || undefined,
    r2_key: r.parentR2Key || undefined,
    trim: { start_s: r.trimStartS, end_s: r.trimEndS },
    match_score: r.score / 10,
    match_rationale: r.reasoning,
  }));

  return {
    brief_id: input.brief.brief_id,
    clip_selections: clipSelections,
  };
}

// ── Helpers ──

function buildSlotDescription(seg: BriefSegment): string {
  const parts: string[] = [];
  parts.push(`${seg.type} segment`);
  if (seg.label) parts.push(`(${seg.label})`);
  if (seg.clip_requirements.content_type.length > 0) {
    parts.push(`showing: ${seg.clip_requirements.content_type.join(', ')}`);
  }
  const mood = Array.isArray(seg.clip_requirements.mood)
    ? seg.clip_requirements.mood.join('/')
    : seg.clip_requirements.mood;
  if (mood) parts.push(`mood: ${mood}`);
  if (seg.clip_requirements.visual_elements?.length) {
    parts.push(`with: ${seg.clip_requirements.visual_elements.join(', ')}`);
  }
  return parts.join(', ');
}

function mapContentTypesToSegmentTypes(seg: BriefSegment): string[] {
  // Map V1's content_type vocabulary to V2's segment_type taxonomy.
  // V1 uses broad content descriptors; V2 has a fixed 8-type enum.
  const typeMap: Record<string, string[]> = {
    'workout': ['exercise', 'hold'],
    'exercise': ['exercise'],
    'demo': ['exercise', 'hold'],
    'hold': ['hold'],
    'transition': ['transition', 'b-roll'],
    'b-roll': ['b-roll'],
    'talking-head': ['talking-head'],
    'cooldown': ['cooldown'],
    'setup': ['setup'],
  };

  const result = new Set<string>();
  for (const ct of seg.clip_requirements.content_type) {
    const mapped = typeMap[ct.toLowerCase()];
    if (mapped) {
      for (const t of mapped) result.add(t);
    }
  }

  // Fallback: if nothing mapped, allow exercise + hold + b-roll (safe defaults)
  if (result.size === 0) {
    result.add('exercise');
    result.add('hold');
    result.add('b-roll');
  }

  return [...result];
}
