import type { ContextPacket, BriefSegment, CaptionPreset, Phase3CreativeBrief, CopyPackage, BrandConfig } from '../types/database.js';
import type { WordTimestamp } from './components/CaptionTrack.js';

/** Props passed to every layout template from the renderer */
export interface TemplateProps {
  contextPacket: ContextPacket;
  /**
   * Bare filenames (no directory) for each segment's clip(s), relative to
   * the renderer's `publicDir`. Templates MUST wrap these in `staticFile()`
   * before passing to `<OffthreadVideo>` etc. — Remotion serves the bundle
   * over HTTP and bare absolute paths or `file://` URLs are rejected by
   * Chromium.
   */
  clipPaths: Record<number, string | string[]>;
  /** Word-level transcription per segment (from whisper) */
  transcriptions: Record<number, WordTimestamp[]>;
  /** Bare filename for logo (relative to publicDir, wrap in staticFile) */
  logoPath: string | null;
  /** Bare filename for background music (relative to publicDir, wrap in staticFile) */
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

// ── Phase 3 types ──

export interface Phase3TemplateProps {
  brief: Phase3CreativeBrief;
  copyPackage: CopyPackage;
  clipPaths: Record<number, string | string[]>;
  transcriptions: Record<number, WordTimestamp[]>;
  logoPath: string | null;
  musicPath: string | null;
  brandConfig: BrandConfig;
  beatMap?: {
    tempo_bpm: number;
    first_beat_offset: number;
    beat_positions: number[];
    duration: number;
  } | null;
}

export interface Phase3ResolvedSegment {
  slotIndex: number;
  type: 'hook' | 'body' | 'cta';
  label: string;
  pacing: 'slow' | 'medium' | 'fast';
  durationFrames: number;
  startFrame: number;
  transitionIn: string;
  transitionDurationFrames: number;
  textOverlay: {
    text: string;
    style: string;
    position: string;
    animation: string;
  };
  clipPath: string | string[];
  energy: number;
}
