import React from 'react';
import { AbsoluteFill, Sequence, Audio, staticFile, useVideoConfig, useCurrentFrame, interpolate } from 'remotion';
import type { Phase3TemplateProps, Phase3ResolvedSegment } from '../types.js';
import { resolvePhase3Segments, totalPhase3Frames } from '../resolve-phase3.js';
import { SegmentVideo } from '../components/SegmentVideo.js';
import { Phase3TextOverlay } from '../components/Phase3TextOverlay.js';
import { TransitionEffect, mapTransitionName } from '../components/TransitionEffect.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { LogoWatermark } from '../components/LogoWatermark.js';
import { getColorTreatmentFilter } from '../color-treatments.js';

export const Phase3Parameterized: React.FC<Phase3TemplateProps> = ({
  brief,
  copyPackage,
  clipPaths,
  transcriptions,
  logoPath,
  musicPath,
  brandConfig,
}) => {
  const { fps } = useVideoConfig();
  const resolved = resolvePhase3Segments(brief, copyPackage, clipPaths, fps);
  const colorFilter = getColorTreatmentFilter(brief.creative_direction.color_treatment);
  const accentColor = brandConfig.accent_color ?? brandConfig.secondary_color;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', filter: colorFilter !== 'none' ? colorFilter : undefined }}>
      {resolved.map((seg, i) => (
        <Sequence key={i} from={seg.startFrame} durationInFrames={seg.durationFrames}>
          <SlotRenderer
            seg={seg}
            index={i}
            resolved={resolved}
            fps={fps}
            font={brandConfig.font_family}
            primaryColor={brandConfig.primary_color}
            accentColor={accentColor}
            ctaBgColor={brandConfig.cta_bg_color}
            ctaTextColor={brandConfig.cta_text_color}
          />
        </Sequence>
      ))}

      {/* Captions — render for slots that have transcription data */}
      {resolved.map((seg) =>
        transcriptions[seg.slotIndex] ? (
          <CaptionTrack
            key={`cap-${seg.slotIndex}`}
            words={transcriptions[seg.slotIndex]}
            preset={brandConfig.caption_preset}
            startFrom={seg.startFrame}
          />
        ) : null,
      )}

      {logoPath && (
        <LogoWatermark
          logoSrc={logoPath}
          position={brandConfig.watermark_position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'}
          opacity={brandConfig.watermark_opacity}
          size={50}
        />
      )}

      {musicPath && (
        <Audio
          src={staticFile(musicPath)}
          volume={brief.audio.music.volume_level}
          startFrom={0}
        />
      )}
    </AbsoluteFill>
  );
};

const SlotRenderer: React.FC<{
  seg: Phase3ResolvedSegment;
  index: number;
  resolved: Phase3ResolvedSegment[];
  fps: number;
  font: string;
  primaryColor: string;
  accentColor: string;
  ctaBgColor: string | null;
  ctaTextColor: string | null;
}> = ({ seg, index, resolved, fps, font, primaryColor, accentColor, ctaBgColor, ctaTextColor }) => {
  const frame = useCurrentFrame();
  const isCrossfade = seg.transitionIn === 'crossfade';
  const transFrames = seg.transitionDurationFrames;

  let clipOpacity = 1;
  if (isCrossfade && index > 0) {
    clipOpacity = interpolate(frame, [0, transFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  const nextSeg = resolved[index + 1];
  const nextIsCrossfade = nextSeg?.transitionIn === 'crossfade';
  if (nextIsCrossfade && nextSeg) {
    const fadeOutStart = seg.durationFrames - nextSeg.transitionDurationFrames;
    clipOpacity *= interpolate(frame, [fadeOutStart, seg.durationFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  }

  const segmentAdapter = {
    clipPath: seg.clipPath,
    durationFrames: seg.durationFrames,
    startFrame: 0,
    endFrame: seg.durationFrames,
    segment: { segment_id: seg.slotIndex } as any,
  };

  return (
    <AbsoluteFill>
      <div style={{ width: '100%', height: '100%', opacity: clipOpacity }}>
        <SegmentVideo segment={segmentAdapter} />
      </div>

      {seg.textOverlay.style !== 'none' && seg.textOverlay.text && (
        <Phase3TextOverlay
          text={seg.textOverlay.text}
          style={seg.textOverlay.style}
          position={seg.textOverlay.position}
          animation={seg.textOverlay.animation}
          durationFrames={seg.durationFrames}
          fps={fps}
          font={font}
          primaryColor={primaryColor}
          accentColor={accentColor}
          ctaBgColor={ctaBgColor}
          ctaTextColor={ctaTextColor}
        />
      )}

      {index > 0 && seg.transitionIn !== 'crossfade' && seg.transitionIn !== 'hard-cut' && (
        <TransitionEffect
          type={mapTransitionName(seg.transitionIn)}
          startFrame={0}
          durationFrames={transFrames}
          color={accentColor}
        />
      )}
    </AbsoluteFill>
  );
};
