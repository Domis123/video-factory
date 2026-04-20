import type { AssetCuratorInput } from './asset-curator.js';
import { selectClips } from './asset-curator.js';
import { curateWithV2, type CuratorV2Brief } from './asset-curator-v2.js';
import type {
  ClipSelectionList,
  ClipSelection,
  BriefSegment,
  CreativeBrief,
  Phase3CreativeBrief,
} from '../types/database.js';
import type { BriefSlot } from './curator-v2-retrieval.js';

export type CuratorDispatchInput =
  | AssetCuratorInput
  | { brief: Phase3CreativeBrief };

/**
 * Flag-gated curator dispatcher. Reads ENABLE_CURATOR_V2 from process.env
 * on every call (not cached — flag is live-flippable).
 *
 * V2 output is reshaped to match V1's ClipSelectionList so pipeline.ts
 * doesn't need to change.
 *
 * Phase 3 briefs pass creative_vision (video-level) and per-slot
 * aesthetic_guidance through to the V2 prompt. Phase 2 briefs leave
 * those fields undefined — the V2 prompt renders fallback strings.
 */
export async function curateAssets(
  input: CuratorDispatchInput,
  brandId: string,
): Promise<ClipSelectionList> {
  const useV2 = process.env['ENABLE_CURATOR_V2'] === 'true';

  if (!useV2) {
    console.log('[curator-dispatch] Using V1 (Sonnet text-based)');
    return selectClips(input as AssetCuratorInput);
  }

  console.log('[curator-dispatch] Using V2 (Gemini Pro + vector retrieval)');

  const isPhase3 = 'creative_direction' in input.brief;
  let v2Brief: CuratorV2Brief;
  let briefId: string;

  if (isPhase3) {
    const p3 = input.brief as Phase3CreativeBrief;
    briefId = p3.brief_id;
    v2Brief = {
      brandId,
      creative_vision: p3.creative_direction.creative_vision,
      slots: p3.segments.map((seg, i): BriefSlot => ({
        index: i,
        description: buildSlotDescription(seg),
        valid_segment_types: mapContentTypesToSegmentTypes(seg),
        min_quality: seg.clip_requirements.min_quality ?? 5,
        aesthetic_guidance: seg.clip_requirements.aesthetic_guidance,
        body_focus: seg.clip_requirements.body_focus ?? undefined,
      })),
    };
  } else {
    const p2 = input.brief as CreativeBrief;
    briefId = p2.brief_id;
    v2Brief = {
      brandId,
      slots: p2.segments.map((seg: BriefSegment): BriefSlot => ({
        index: seg.segment_id,
        description: buildSlotDescription(seg),
        valid_segment_types: mapContentTypesToSegmentTypes(seg),
        min_quality: seg.clip_requirements.min_quality ?? 5,
      })),
    };
  }

  const v2Results = await curateWithV2(v2Brief);

  // Reshape V2 results to V1 ClipSelectionList
  const clipSelections: ClipSelection[] = v2Results.map((r) => ({
    segment_id: r.slotIndex,
    asset_id: r.parentAssetId || undefined,
    asset_segment_id: r.segmentId || undefined,
    r2_key: r.parentR2Key || undefined,
    trim: { start_s: r.trimStartS, end_s: r.trimEndS },
    match_score: r.score / 10,
    match_rationale: r.reasoning,
  }));

  return {
    brief_id: briefId,
    clip_selections: clipSelections,
  };
}

// ── Helpers ──

interface SegmentLike {
  type: string;
  label?: string;
  clip_requirements: {
    content_type: string[];
    mood: string | string[];
    visual_elements?: string[];
    body_focus?: string | null;
  };
}

function buildSlotDescription(seg: SegmentLike): string {
  const parts: string[] = [];
  parts.push(`${seg.type} segment`);
  if (seg.label) parts.push(`(${seg.label})`);
  if (seg.clip_requirements.content_type.length > 0) {
    parts.push(`showing: ${seg.clip_requirements.content_type.join(', ')}`);
  }
  if (seg.clip_requirements.body_focus) {
    parts.push(`body focus: ${seg.clip_requirements.body_focus}`);
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

function mapContentTypesToSegmentTypes(seg: SegmentLike): string[] {
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

  // Hard filter (Phase 3.5f): setup segments are never valid for
  // slots requesting exercise/workout/demo content. Setup means
  // exercise positioning, adjusting, checking phone — not the
  // active movement an exercise slot needs.
  const requestsActiveExercise = seg.clip_requirements.content_type.some((ct) =>
    ['exercise', 'workout', 'demo'].includes(ct.toLowerCase()),
  );
  if (requestsActiveExercise) {
    result.delete('setup');
  }

  return [...result];
}
