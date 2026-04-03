import React from 'react';
import { Img, staticFile, useCurrentFrame, interpolate } from 'remotion';

interface LogoWatermarkProps {
  logoSrc: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity?: number;
  size?: number;
  fadeInFrames?: number;
}

/**
 * Brand logo watermark — persistent, subtle overlay.
 * Positioned consistently per brand config, fades in gently.
 */
export const LogoWatermark: React.FC<LogoWatermarkProps> = ({
  logoSrc,
  position = 'bottom-right',
  opacity = 0.7,
  size = 60,
  fadeInFrames = 15,
}) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, fadeInFrames], [0, opacity], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const posStyle = getPositionStyle(position);

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        zIndex: 25,
        opacity: fadeIn,
        padding: 20,
      }}
    >
      <Img
        src={logoSrc}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
        }}
      />
    </div>
  );
};

function getPositionStyle(position: string): React.CSSProperties {
  switch (position) {
    case 'top-left':
      return { top: 0, left: 0 };
    case 'top-right':
      return { top: 0, right: 0 };
    case 'bottom-left':
      return { bottom: 0, left: 0 };
    case 'bottom-right':
    default:
      return { bottom: 0, right: 0 };
  }
}
