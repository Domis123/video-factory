import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

interface HookTextProps {
  text: string;
  fontFamily: string;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position?: 'center' | 'top' | 'bottom';
  animation?: 'pop-in' | 'slide-up' | 'typewriter' | 'scale-rotate' | 'glitch';
  durationFrames: number;
  startFrame?: number;
  shadowColor?: string;
}

/**
 * Hook text overlay — the first thing viewers see.
 * Must be punchy, bold, and perfectly timed to grab attention in <2s.
 */
export const HookText: React.FC<HookTextProps> = ({
  text,
  fontFamily,
  fontSize = 64,
  fontWeight = 800,
  textColor = '#FFFFFF',
  strokeColor = '#000000',
  strokeWidth = 3,
  position = 'center',
  animation = 'pop-in',
  durationFrames,
  startFrame = 0,
  shadowColor = 'rgba(0,0,0,0.6)',
}) => {
  const frame = useCurrentFrame() - startFrame;
  const { fps } = useVideoConfig();

  if (frame < 0 || frame > durationFrames) return null;

  // Exit animation (fade out in last 5 frames)
  const exitOpacity = interpolate(frame, [durationFrames - 5, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const animProps = getAnimation(animation, frame, fps);

  const posStyle = getPositionStyle(position);

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 8%',
        zIndex: 20,
        opacity: animProps.opacity * exitOpacity,
        transform: animProps.transform,
      }}
    >
      <h1
        style={{
          fontFamily,
          fontSize,
          fontWeight,
          color: textColor,
          textAlign: 'center',
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : undefined,
          textShadow: `0 4px 20px ${shadowColor}, 0 2px 6px rgba(0,0,0,0.4)`,
          margin: 0,
          maxWidth: '90%',
          wordBreak: 'break-word',
        }}
      >
        {animation === 'typewriter' ? (
          <TypewriterText text={text} frame={frame} fps={fps} />
        ) : (
          text
        )}
      </h1>
    </div>
  );
};

interface AnimResult {
  opacity: number;
  transform: string;
}

function getAnimation(type: string, frame: number, fps: number): AnimResult {
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 180, mass: 0.6 } });

  switch (type) {
    case 'pop-in':
      return {
        opacity: s,
        transform: `scale(${interpolate(s, [0, 1], [0.3, 1])})`,
      };

    case 'slide-up':
      return {
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [80, 0])}px)`,
      };

    case 'scale-rotate':
      return {
        opacity: s,
        transform: `scale(${interpolate(s, [0, 1], [0.2, 1])}) rotate(${interpolate(s, [0, 1], [-8, 0])}deg)`,
      };

    case 'glitch': {
      const glitchOffset = frame < 4 ? Math.sin(frame * 15) * 6 : 0;
      return {
        opacity: frame < 2 ? 0.7 : 1,
        transform: `translateX(${glitchOffset}px)`,
      };
    }

    case 'typewriter':
      return { opacity: 1, transform: 'none' };

    default:
      return { opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.5, 1])})` };
  }
}

const TypewriterText: React.FC<{ text: string; frame: number; fps: number }> = ({ text, frame, fps }) => {
  const charsPerSecond = 25;
  const visibleChars = Math.floor((frame / fps) * charsPerSecond);
  const displayed = text.slice(0, Math.min(visibleChars, text.length));

  return (
    <>
      {displayed}
      {visibleChars < text.length && (
        <span style={{ opacity: frame % 8 < 4 ? 1 : 0 }}>|</span>
      )}
    </>
  );
};

function getPositionStyle(position: string): React.CSSProperties {
  switch (position) {
    case 'top':
      return { top: '12%', left: 0 };
    case 'bottom':
      return { bottom: '18%', left: 0 };
    case 'center':
    default:
      return { top: '50%', left: 0, transform: 'translateY(-50%)' };
  }
}
