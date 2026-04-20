import type { SegmentV2 } from '../agents/segment-analyzer-v2-schema.js';

export interface V1SegmentColumns {
  start_s: number;
  end_s: number;
  segment_type: string;
  description: string;
  visual_tags: string[];
  best_used_as: string[];
  motion_intensity: number;
  recommended_duration_s: number;
  has_speech: boolean;
  quality_score: number;
}

const VELOCITY_TO_MOTION_INTENSITY: Record<string, number> = {
  static: 1,
  slow: 3,
  moderate: 6,
  fast: 9,
};

const SUITABILITY_INCLUDE = new Set(['excellent', 'good']);

export function projectV2ToV1Columns(seg: SegmentV2): V1SegmentColumns {
  const motion_intensity = VELOCITY_TO_MOTION_INTENSITY[seg.motion.velocity];
  if (motion_intensity === undefined) {
    throw new Error(`projectV2ToV1Columns: unknown motion.velocity "${seg.motion.velocity}"`);
  }

  const best_used_as: string[] = [];
  if (SUITABILITY_INCLUDE.has(seg.editorial.hook_suitability)) best_used_as.push('hook');
  if (SUITABILITY_INCLUDE.has(seg.editorial.demo_suitability)) best_used_as.push('demo');
  if (SUITABILITY_INCLUDE.has(seg.editorial.transition_suitability)) best_used_as.push('transition');
  if (seg.segment_type === 'talking-head') best_used_as.push('talking-head');
  if (seg.segment_type === 'b-roll') best_used_as.push('b-roll');

  return {
    start_s: seg.start_s,
    end_s: seg.end_s,
    segment_type: seg.segment_type,
    description: seg.description,
    visual_tags: seg.visual_tags,
    best_used_as,
    motion_intensity,
    recommended_duration_s: seg.recommended_duration_s,
    has_speech: seg.audio.has_speech,
    quality_score: seg.quality.overall,
  };
}
