import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

interface TransitionEffectProps {
  type: 'cut' | 'fade' | 'slide-left' | 'slide-up' | 'zoom' | 'wipe' | 'beat-flash' | 'beat-zoom';
  durationFrames?: number;
  startFrame: number;
  color?: string;
  /** Frame aligned to a musical beat (overrides startFrame for beat-synced transitions) */
  beatAlignedFrame?: number;
}

/**
 * Transition between video segments.
 * Renders an overlay layer that covers the outgoing clip.
 * "cut" renders nothing (instant cut). Others animate for the specified frames.
 */
export const TransitionEffect: React.FC<TransitionEffectProps> = ({
  type,
  durationFrames = 8,
  startFrame,
  color = '#000000',
  beatAlignedFrame,
}) => {
  const frame = useCurrentFrame();
  const effectiveStart = beatAlignedFrame ?? startFrame;
  const localFrame = frame - effectiveStart;

  if (type === 'cut' || localFrame < 0 || localFrame > durationFrames) return null;

  const progress = localFrame / durationFrames;

  const style = getTransitionStyle(type, progress, durationFrames, localFrame, color);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 50,
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
};

function getTransitionStyle(
  type: string,
  progress: number,
  durationFrames: number,
  localFrame: number,
  color: string,
): React.CSSProperties {
  // First half: overlay comes in. Second half: overlay leaves.
  const isFirstHalf = progress <= 0.5;
  const halfProgress = isFirstHalf ? progress * 2 : (1 - progress) * 2;

  switch (type) {
    case 'fade':
      return {
        backgroundColor: color,
        opacity: interpolate(localFrame, [0, durationFrames / 2, durationFrames], [0, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      };

    case 'slide-left':
      return {
        backgroundColor: color,
        transform: isFirstHalf
          ? `translateX(${interpolate(halfProgress, [0, 1], [100, 0])}%)`
          : `translateX(${interpolate(halfProgress, [0, 1], [-100, 0])}%)`,
      };

    case 'slide-up':
      return {
        backgroundColor: color,
        transform: isFirstHalf
          ? `translateY(${interpolate(halfProgress, [0, 1], [100, 0])}%)`
          : `translateY(${interpolate(halfProgress, [0, 1], [-100, 0])}%)`,
      };

    case 'zoom':
      return {
        backgroundColor: color,
        opacity: interpolate(localFrame, [0, durationFrames / 2, durationFrames], [0, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        transform: `scale(${interpolate(localFrame, [0, durationFrames], [0.5, 1.5])})`,
        borderRadius: '50%',
      };

    case 'wipe': {
      const clipPercent = isFirstHalf
        ? interpolate(halfProgress, [0, 1], [0, 100])
        : interpolate(halfProgress, [0, 1], [0, 100]);
      return {
        backgroundColor: color,
        clipPath: isFirstHalf
          ? `inset(0 ${100 - clipPercent}% 0 0)`
          : `inset(0 0 0 ${100 - clipPercent}%)`,
      };
    }

    case 'beat-flash':
      // Quick white flash on beat — 4 frames total
      return {
        backgroundColor: '#ffffff',
        opacity: interpolate(localFrame, [0, 2, durationFrames], [0.8, 0.6, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      };

    case 'beat-zoom':
      // Scale punch on beat — starts slightly zoomed, snaps back
      return {
        backgroundColor: color,
        opacity: interpolate(localFrame, [0, durationFrames / 3, durationFrames], [0.5, 0.3, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        transform: `scale(${interpolate(localFrame, [0, durationFrames], [1.15, 1.0])})`,
      };

    default:
      return {};
  }
}
