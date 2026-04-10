import type { ContextPacket, BriefSegment, CaptionPreset } from '../types/database.js';
import type { WordTimestamp } from './components/CaptionTrack.js';

/** Props passed to every layout template from the renderer */
export interface TemplateProps {
  contextPacket: ContextPacket;
  /**
   * Pre-resolved `file://` URLs for each clip (keyed by segment_id). The
   * renderer converts every local filesystem path to a `file://` URL before
   * passing props in, because Remotion serves the template bundle from a
   * temp webpack dir and Chromium otherwise resolves bare absolute paths
   * against that bundle root (producing 404s for real filesystem files).
   */
  clipPaths: Record<number, string | string[]>;
  /** Word-level transcription per segment (from whisper) */
  transcriptions: Record<number, WordTimestamp[]>;
  /** Pre-resolved `file://` URL for logo (same reason as clipPaths) */
  logoPath: string | null;
  /** Pre-resolved `file://` URL for background music */
  musicPath: string | null;
  /** Beat map from music track (for beat-synced transitions) */
  beatMap?: {
    tempo_bpm: number;
    first_beat_offset: number;
    beat_positions: number[];
    duration: number;
  } | null;
}

/** Computed segment with frame-level timing */
export interface ResolvedSegment {
  segment: BriefSegment;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  clipPath: string | string[];
}

/** Resolve segments into frame-level timing */
export function resolveSegments(
  segments: BriefSegment[],
  clipPaths: Record<number, string | string[]>,
  fps: number,
): ResolvedSegment[] {
  let currentFrame = 0;
  return segments.map((seg) => {
    const durationFrames = Math.round(seg.duration_target * fps);
    const resolved: ResolvedSegment = {
      segment: seg,
      startFrame: currentFrame,
      endFrame: currentFrame + durationFrames,
      durationFrames,
      clipPath: clipPaths[seg.segment_id] ?? '',
    };
    currentFrame += durationFrames;
    return resolved;
  });
}

/** Total duration in frames from segments */
export function totalFrames(segments: BriefSegment[], fps: number): number {
  return segments.reduce((sum, s) => sum + Math.round(s.duration_target * fps), 0);
}
