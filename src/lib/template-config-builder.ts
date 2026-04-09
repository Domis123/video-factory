/**
 * Template Config Builder — Phase 7
 *
 * Reads the brief's energy curve + beat map to compute per-segment
 * transition timing, animation speeds, and clip hold durations.
 * Populates `template_config` which layouts read for dynamic values.
 */

import type { BriefSegment } from '../types/database.js';
import type { BeatMap } from './beat-detector.js';
import { snapToNearestBeat } from './beat-detector.js';

export interface SegmentConfig {
  segment_id: number;
  /** Computed clip hold duration in seconds (from pacing) */
  clip_hold_duration: number;
  /** Transition duration in frames (shorter = snappier) */
  transition_frames: number;
  /** Animation speed multiplier (1.0 = normal, >1 = faster) */
  animation_speed: number;
  /** Beat-snapped transition start time in seconds (null if no beat map) */
  beat_transition_time: number | null;
}

export interface TemplateConfig {
  segments: SegmentConfig[];
  /** Global animation speed multiplier based on average energy */
  global_animation_speed: number;
  /** Whether beat sync is active */
  beat_sync_active: boolean;
}

/**
 * Build template config from brief segments and optional beat map.
 */
export function buildTemplateConfig(
  segments: BriefSegment[],
  beatMap: BeatMap | null,
  fps: number = 30,
): TemplateConfig {
  let cumulativeTime = 0;
  const segmentConfigs: SegmentConfig[] = [];

  for (const seg of segments) {
    const energy = seg.energy_level ?? 5;
    const pacing = seg.pacing ?? 'medium';

    // Clip hold duration from pacing
    const clipHold = PACING_HOLD_DURATION[pacing];

    // Transition duration scales inversely with energy
    // High energy (8-10) = 4-6 frames (snappy)
    // Low energy (1-3) = 10-15 frames (smooth)
    const transitionFrames = Math.round(mapRange(energy, 1, 10, 15, 4));

    // Animation speed scales with energy
    const animationSpeed = mapRange(energy, 1, 10, 0.7, 1.5);

    // Beat-snap the transition point
    const transitionTime = cumulativeTime + seg.duration_target;
    const beatTransitionTime = beatMap
      ? snapToNearestBeat(transitionTime, beatMap)
      : null;

    segmentConfigs.push({
      segment_id: seg.segment_id,
      clip_hold_duration: clipHold,
      transition_frames: transitionFrames,
      animation_speed: Math.round(animationSpeed * 100) / 100,
      beat_transition_time: beatTransitionTime,
    });

    cumulativeTime += seg.duration_target;
  }

  // Global animation speed from average energy
  const avgEnergy = segments.reduce((sum, s) => sum + (s.energy_level ?? 5), 0) / segments.length;
  const globalSpeed = mapRange(avgEnergy, 1, 10, 0.8, 1.3);

  return {
    segments: segmentConfigs,
    global_animation_speed: Math.round(globalSpeed * 100) / 100,
    beat_sync_active: !!beatMap,
  };
}

/** Pacing → clip hold duration in seconds */
const PACING_HOLD_DURATION: Record<string, number> = {
  fast: 1.5,
  medium: 3.0,
  slow: 5.0,
};

/** Linear interpolation between ranges */
function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin);
}
