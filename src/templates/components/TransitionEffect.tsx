import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

const PHASE3_TRANSITION_MAP: Record<string, string> = {
  'hard-cut': 'cut',
  'crossfade': 'crossfade',
  'slide': 'slide-left',
  'zoom': 'zoom',
  'whip-pan': 'whip-pan',
  'fade-from-black': 'fade-from-black',
};

export function mapTransitionName(name: string): string {
  return PHASE3_TRANSITION_MAP[name] || name;
}

interface TransitionEffectProps {
  type: string;
  durationFrames?: number;
  startFrame: number;
  color?: string;
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

  if (type === 'cut' || type === 'crossfade' || localFrame < 0 || localFrame > durationFrames) return null;

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

    case 'fade-from-black':
      return {
        backgroundColor: '#000000',
        opacity: interpolate(localFrame, [0, durationFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      };

    case 'fade-to-black':
      return {
        backgroundColor: '#000000',
        opacity: interpolate(localFrame, [0, durationFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      };

    case 'slide-down':
      return {
        backgroundColor: color,
        transform: isFirstHalf
          ? `translateY(${interpolate(halfProgress, [0, 1], [-100, 0])}%)`
          : `translateY(${interpolate(halfProgress, [0, 1], [100, 0])}%)`,
      };

    case 'slide-right':
      return {
        backgroundColor: color,
        transform: isFirstHalf
          ? `translateX(${interpolate(halfProgress, [0, 1], [-100, 0])}%)`
          : `translateX(${interpolate(halfProgress, [0, 1], [100, 0])}%)`,
      };

    case 'whip-pan':
      return {
        backgroundColor: color,
        opacity: interpolate(localFrame, [0, durationFrames * 0.3, durationFrames], [0.6, 0.8, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        transform: `translateX(${interpolate(localFrame, [0, durationFrames], [-100, 100])}%)`,
        filter: `blur(${interpolate(localFrame, [0, durationFrames / 2, durationFrames], [0, 8, 0])}px)`,
      };

    case 'blur-through':
      return {
        backdropFilter: `blur(${interpolate(localFrame, [0, durationFrames / 2, durationFrames], [0, 20, 0])}px)`,
      };

    case 'glitch': {
      const seed = localFrame * 17;
      const jitter1 = Math.sin(seed) * 20;
      const jitter2 = Math.cos(seed * 1.3) * 15;
      const flickerOpacity = localFrame % 3 === 0 ? 0.7 : localFrame % 3 === 1 ? 0.5 : 0.9;
      return {
        background: `linear-gradient(${jitter1}deg, ${color}88, #ff000066, #00ff0066)`,
        opacity: flickerOpacity * interpolate(localFrame, [0, durationFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        transform: `translateX(${jitter2}px)`,
      };
    }

    default:
      return {};
  }
}
