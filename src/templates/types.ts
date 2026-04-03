import type { ContextPacket, BriefSegment, CaptionPreset } from '../types/database.js';
import type { WordTimestamp } from './components/CaptionTrack.js';

/** Props passed to every layout template from the renderer */
export interface TemplateProps {
  contextPacket: ContextPacket;
  /** Pre-resolved local paths for each clip (keyed by segment_id) */
  clipPaths: Record<number, string | string[]>;
  /** Word-level transcription per segment (from whisper) */
  transcriptions: Record<number, WordTimestamp[]>;
  /** Pre-resolved local path for logo */
  logoPath: string | null;
  /** Pre-resolved local path for background music */
  musicPath: string | null;
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
