import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

interface CTAScreenProps {
  text: string;
  fontFamily: string;
  style?: 'link-in-bio' | 'swipe-up' | 'follow' | 'shop-now' | 'minimal';
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
  durationFrames: number;
  startFrame?: number;
  brandName?: string;
}

/**
 * CTA end screen — the final push to action.
 * Clean, brand-colored, with clear actionable text and subtle animation.
 */
export const CTAScreen: React.FC<CTAScreenProps> = ({
  text,
  fontFamily,
  style = 'link-in-bio',
  bgColor,
  textColor = '#FFFFFF',
  accentColor = '#e94560',
  durationFrames,
  startFrame = 0,
  brandName,
}) => {
  const frame = useCurrentFrame() - startFrame;
  const { fps } = useVideoConfig();

  if (frame < 0 || frame > durationFrames) return null;

  const entrance = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.5 } });

  // Subtle pulse on the CTA button/badge
  const pulsePhase = Math.sin(((frame - 15) / fps) * Math.PI * 2) * 0.03;
  const buttonScale = frame > 15 ? 1 + pulsePhase : interpolate(entrance, [0, 1], [0.5, 1]);

  // Exit fade
  const exitOpacity = interpolate(frame, [durationFrames - 8, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 15,
        opacity: exitOpacity,
      }}
    >
      {/* Semi-transparent overlay for readability over video */}
      {bgColor && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: bgColor,
            opacity: interpolate(entrance, [0, 1], [0, 0.7]),
          }}
        />
      )}

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          opacity: entrance,
          transform: `translateY(${interpolate(entrance, [0, 1], [40, 0])}px)`,
        }}
      >
        {/* CTA text */}
        <p
          style={{
            fontFamily,
            fontSize: 42,
            fontWeight: 700,
            color: textColor,
            textAlign: 'center',
            margin: 0,
            maxWidth: '80%',
            lineHeight: 1.2,
            textShadow: '0 3px 12px rgba(0,0,0,0.5)',
            letterSpacing: '-0.02em',
          }}
        >
          {text}
        </p>

        {/* Action badge/button */}
        {renderBadge(style, accentColor, textColor, fontFamily, buttonScale)}

        {/* Brand name watermark */}
        {brandName && (
          <p
            style={{
              fontFamily,
              fontSize: 16,
              fontWeight: 500,
              color: textColor,
              opacity: 0.6,
              margin: 0,
              marginTop: 8,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {brandName}
          </p>
        )}
      </div>
    </div>
  );
};

function renderBadge(
  style: string,
  accentColor: string,
  textColor: string,
  fontFamily: string,
  scale: number,
): React.ReactNode {
  const badgeText = getBadgeText(style);
  if (!badgeText) return null;

  return (
    <div
      style={{
        backgroundColor: accentColor,
        borderRadius: 50,
        padding: '12px 32px',
        transform: `scale(${scale})`,
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize: 20,
          fontWeight: 700,
          color: textColor,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {badgeText}
      </span>
    </div>
  );
}

function getBadgeText(style: string): string | null {
  switch (style) {
    case 'link-in-bio': return 'LINK IN BIO';
    case 'swipe-up': return 'SWIPE UP';
    case 'follow': return 'FOLLOW';
    case 'shop-now': return 'SHOP NOW';
    case 'minimal': return null;
    default: return null;
  }
}
