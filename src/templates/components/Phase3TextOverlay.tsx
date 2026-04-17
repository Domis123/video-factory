import React from 'react';
import { useCurrentFrame, spring, interpolate } from 'remotion';

interface Phase3TextOverlayProps {
  text: string;
  style: string;
  position: string;
  animation: string;
  durationFrames: number;
  fps: number;
  font: string;
  primaryColor: string;
  accentColor: string;
}

export const Phase3TextOverlay: React.FC<Phase3TextOverlayProps> = ({
  text,
  style,
  position,
  animation,
  durationFrames,
  fps,
  font,
  primaryColor,
  accentColor,
}) => {
  const frame = useCurrentFrame();

  if (style === 'none' || !text) return null;

  const exitOpacity = interpolate(frame, [durationFrames - 6, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const anim = getAnimationValues(animation, frame, fps);
  const posStyle = getPositionStyle(position);
  const textStyle = getTextStyle(style, font, primaryColor, accentColor);

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        width: '100%',
        display: 'flex',
        justifyContent: getJustify(position),
        padding: '0 6%',
        zIndex: 20,
        opacity: anim.opacity * exitOpacity,
        transform: anim.transform,
        pointerEvents: 'none',
      }}
    >
      <div style={textStyle.wrapper}>
        {animation === 'type-on' ? (
          <TypeOnText text={text} frame={frame} fps={fps} style={textStyle.text} />
        ) : (
          <span style={textStyle.text}>{text}</span>
        )}
      </div>
    </div>
  );
};

function getAnimationValues(type: string, frame: number, fps: number) {
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
        transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`,
      };
    case 'fade':
      return {
        opacity: interpolate(frame, [0, 8], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        transform: 'none',
      };
    case 'type-on':
      return { opacity: 1, transform: 'none' };
    case 'none':
    default:
      return { opacity: 1, transform: 'none' };
  }
}

function getPositionStyle(position: string): React.CSSProperties {
  switch (position) {
    case 'top-left':
    case 'top-center':
    case 'top-right':
      return { top: '10%', left: 0 };
    case 'center':
      return { top: '50%', left: 0, transform: 'translateY(-50%)' };
    case 'bottom-left':
    case 'bottom-center':
    case 'bottom-right':
    default:
      return { bottom: '16%', left: 0 };
  }
}

function getJustify(position: string): string {
  if (position.endsWith('-left')) return 'flex-start';
  if (position.endsWith('-right')) return 'flex-end';
  return 'center';
}

interface TextStyles {
  wrapper: React.CSSProperties;
  text: React.CSSProperties;
}

function getTextStyle(
  style: string,
  font: string,
  primaryColor: string,
  accentColor: string,
): TextStyles {
  switch (style) {
    case 'bold-center':
      return {
        wrapper: {},
        text: {
          fontFamily: font,
          fontSize: 64,
          fontWeight: 800,
          color: '#FFFFFF',
          textAlign: 'center',
          textTransform: 'uppercase',
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          textShadow: '0 4px 20px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)',
          maxWidth: '90%',
        },
      };
    case 'subtitle':
      return {
        wrapper: {
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: 8,
          padding: '8px 20px',
        },
        text: {
          fontFamily: font,
          fontSize: 36,
          fontWeight: 400,
          color: '#FFFFFF',
          textAlign: 'center',
          lineHeight: 1.3,
          maxWidth: '85%',
        },
      };
    case 'label':
      return {
        wrapper: {
          backgroundColor: 'rgba(0,0,0,0.45)',
          borderRadius: 6,
          padding: '6px 16px',
        },
        text: {
          fontFamily: font,
          fontSize: 28,
          fontWeight: 600,
          color: '#FFFFFF',
          lineHeight: 1.2,
        },
      };
    case 'cta':
      return {
        wrapper: {
          backgroundColor: accentColor,
          borderRadius: 50,
          padding: '12px 32px',
        },
        text: {
          fontFamily: font,
          fontSize: 48,
          fontWeight: 700,
          color: '#FFFFFF',
          textAlign: 'center',
          lineHeight: 1.2,
        },
      };
    case 'minimal':
      return {
        wrapper: {},
        text: {
          fontFamily: font,
          fontSize: 24,
          fontWeight: 300,
          color: 'rgba(255,255,255,0.85)',
          textAlign: 'center',
          letterSpacing: '0.05em',
        },
      };
    default:
      return {
        wrapper: {},
        text: {
          fontFamily: font,
          fontSize: 36,
          fontWeight: 500,
          color: '#FFFFFF',
          textAlign: 'center',
        },
      };
  }
}

const TypeOnText: React.FC<{
  text: string;
  frame: number;
  fps: number;
  style: React.CSSProperties;
}> = ({ text, frame, fps, style: textStyle }) => {
  const charsPerSecond = 20;
  const visibleChars = Math.floor((frame / fps) * charsPerSecond);
  const displayed = text.slice(0, Math.min(visibleChars, text.length));

  return (
    <span style={textStyle}>
      {displayed}
      {visibleChars < text.length && (
        <span style={{ opacity: frame % 8 < 4 ? 1 : 0 }}>|</span>
      )}
    </span>
  );
};
