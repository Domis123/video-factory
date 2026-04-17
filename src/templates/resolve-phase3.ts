import type { Phase3CreativeBrief, CopyPackage } from '../types/database.js';
import type { Phase3ResolvedSegment } from './types.js';

export function resolvePhase3Segments(
  brief: Phase3CreativeBrief,
  copyPackage: CopyPackage,
  clipPaths: Record<number, string | string[]>,
  fps: number,
): Phase3ResolvedSegment[] {
  const resolved: Phase3ResolvedSegment[] = [];
  let currentFrame = 0;

  for (let i = 0; i < brief.segments.length; i++) {
    const seg = brief.segments[i];
    const durationFrames = Math.round(seg.cut_duration_target_s * fps);
    const transitionDurationFrames = seg.transition_in === 'hard-cut' ? 0 : 10;

    const startFrame = i === 0
      ? 0
      : currentFrame - transitionDurationFrames;

    const overlay = copyPackage.overlays.find((o) => o.segment_id === i);
    const overlayText = overlay?.text ?? overlay?.sub_overlays?.[0]?.text ?? '';

    resolved.push({
      slotIndex: i,
      type: seg.type,
      label: seg.label,
      pacing: seg.pacing,
      durationFrames,
      startFrame,
      transitionIn: seg.transition_in,
      transitionDurationFrames,
      textOverlay: {
        text: overlayText,
        style: seg.text_overlay.style,
        position: seg.text_overlay.position,
        animation: seg.text_overlay.animation,
      },
      clipPath: clipPaths[i] ?? '',
      energy: brief.creative_direction.energy_per_slot[i] ?? 5,
    });

    currentFrame = startFrame + durationFrames;
  }

  return resolved;
}

export function totalPhase3Frames(resolved: Phase3ResolvedSegment[]): number {
  if (resolved.length === 0) return 0;
  const last = resolved[resolved.length - 1];
  return last.startFrame + last.durationFrames;
}
