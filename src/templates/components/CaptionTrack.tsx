import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import type { CaptionPreset } from '../../types/database.js';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface CaptionTrackProps {
  words: WordTimestamp[];
  preset: CaptionPreset;
  startFrom?: number; // offset in frames
}

/**
 * Word-by-word animated captions driven by brand caption preset.
 * Supports highlight, pop, and karaoke animation styles.
 */
export const CaptionTrack: React.FC<CaptionTrackProps> = ({ words, preset, startFrom = 0 }) => {
  const frame = useCurrentFrame() - startFrom;
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;
  const style = preset.style;

  // Group words into lines (max ~5 words per line for readability)
  const lines = groupWordsIntoLines(words, 5);

  // Find the active line based on current time
  const activeLineIdx = lines.findIndex(
    (line) => currentTime >= line[0].start && currentTime <= line[line.length - 1].end + 0.3
  );

  if (activeLineIdx === -1 || frame < 0) return null;

  const activeLine = lines[activeLineIdx];

  const positionStyle = getPositionStyle(style.position, style.margin_bottom_px);

  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyle,
        width: '100%',
        display: 'flex',
        justifyContent: style.text_align === 'left' ? 'flex-start' : style.text_align === 'right' ? 'flex-end' : 'center',
        padding: '0 5%',
        zIndex: 10,
      }}
    >
      <div
        style={{
          maxWidth: `${style.max_width_percent}%`,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '4px',
        }}
      >
        {activeLine.map((w, i) => (
          <CaptionWord
            key={`${activeLineIdx}-${i}`}
            word={w}
            currentTime={currentTime}
            style={style}
            fps={fps}
            frame={frame}
            index={i}
          />
        ))}
      </div>
    </div>
  );
};

interface CaptionWordProps {
  word: WordTimestamp;
  currentTime: number;
  style: CaptionPreset['style'];
  fps: number;
  frame: number;
  index: number;
}

const CaptionWord: React.FC<CaptionWordProps> = ({ word, currentTime, style: s, fps, frame, index }) => {
  const isActive = currentTime >= word.start && currentTime <= word.end;
  const isPast = currentTime > word.end;
  const animType = s.animation.type;

  // Spring entrance for each word
  const entrance = spring({
    frame: frame - Math.floor(word.start * fps),
    fps,
    config: { damping: 15, stiffness: 200, mass: 0.5 },
  });

  const scale = animType === 'word-pop'
    ? interpolate(entrance, [0, 1], [0.6, 1])
    : 1;

  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  // Highlight color for active word
  let backgroundColor = 'transparent';
  let textColor = s.text_color;

  if (animType === 'word-highlight' && isActive) {
    if (s.animation.highlight_style === 'background') {
      backgroundColor = s.animation.highlight_color;
      textColor = '#FFFFFF';
    } else {
      textColor = s.animation.highlight_color;
    }
  } else if (animType === 'karaoke') {
    textColor = isActive || isPast ? s.animation.highlight_color : s.text_color;
  }

  const textShadow = s.shadow.blur > 0
    ? `${s.shadow.offset_x}px ${s.shadow.offset_y}px ${s.shadow.blur}px ${s.shadow.color}`
    : 'none';

  return (
    <span
      style={{
        fontFamily: s.font_family,
        fontSize: s.font_size,
        fontWeight: isActive ? Math.min(s.font_weight + 100, 900) : s.font_weight,
        color: textColor,
        backgroundColor,
        borderRadius: backgroundColor !== 'transparent' ? 6 : 0,
        padding: backgroundColor !== 'transparent' ? '2px 8px' : '0 2px',
        WebkitTextStroke: s.stroke_width > 0 ? `${s.stroke_width}px ${s.stroke_color}` : undefined,
        textShadow,
        transform: `scale(${scale})`,
        opacity,
        display: 'inline-block',
        transition: 'background-color 0.1s, color 0.1s',
        letterSpacing: '-0.02em',
      }}
    >
      {word.word}
    </span>
  );
};

function groupWordsIntoLines(words: WordTimestamp[], maxPerLine: number): WordTimestamp[][] {
  const lines: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    lines.push(words.slice(i, i + maxPerLine));
  }
  return lines;
}

function getPositionStyle(position: string, marginBottom: number): React.CSSProperties {
  switch (position) {
    case 'top-center':
      return { top: 80, left: 0 };
    case 'center':
      return { top: '50%', left: 0, transform: 'translateY(-50%)' };
    case 'bottom-center':
    default:
      return { bottom: marginBottom, left: 0 };
  }
}
