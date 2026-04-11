import React from 'react';
import { OffthreadVideo, Sequence, staticFile, useVideoConfig } from 'remotion';
import type { ResolvedSegment } from '../types.js';

interface SegmentVideoProps {
  segment: ResolvedSegment;
}

/**
 * Renders one or more video clips for a segment.
 * Multi-clip segments play clips sequentially within the segment's frame range.
 */
export const SegmentVideo: React.FC<SegmentVideoProps> = ({ segment }) => {
  const { fps } = useVideoConfig();
  const clips = Array.isArray(segment.clipPath) ? segment.clipPath : [segment.clipPath];

  if (clips.length === 0 || !clips[0]) return null;

  // The renderer hands us bare filenames (e.g. "seg1-clip0.mp4") that live
  // inside the bundle's publicDir. staticFile() turns them into the
  // http://localhost:port/{filename} URL Remotion's bundle server actually
  // serves — passing raw paths or file:// URLs would 404 in Chromium.

  // Single clip: just render it
  if (clips.length === 1) {
    return (
      <OffthreadVideo
        src={staticFile(clips[0])}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  // Multi-clip: distribute duration evenly across clips
  const framesPerClip = Math.floor(segment.durationFrames / clips.length);

  return (
    <>
      {clips.map((clip, i) => (
        <Sequence
          key={i}
          from={i * framesPerClip}
          durationInFrames={i === clips.length - 1
            ? segment.durationFrames - i * framesPerClip
            : framesPerClip}
        >
          <OffthreadVideo
            src={staticFile(clip)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Sequence>
      ))}
    </>
  );
};
