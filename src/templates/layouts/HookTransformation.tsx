import React from 'react';
import { AbsoluteFill, Sequence, Audio, useVideoConfig, useCurrentFrame, spring, interpolate } from 'remotion';
import type { TemplateProps } from '../types.js';
import { resolveSegments } from '../types.js';
import { SegmentVideo } from '../components/SegmentVideo.js';
import { HookText } from '../components/HookText.js';
import { CTAScreen } from '../components/CTAScreen.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { LogoWatermark } from '../components/LogoWatermark.js';
import { TransitionEffect } from '../components/TransitionEffect.js';

/**
 * Hook → Before/After Transformation → CTA
 * Best for: fitness results, diet progress, skincare, makeovers.
 *
 * The body segment shows a dramatic before/after comparison
 * with a split-wipe reveal animation.
 */
export const HookTransformation: React.FC<TemplateProps> = ({
  contextPacket,
  clipPaths,
  transcriptions,
  logoPath,
  musicPath,
}) => {
  const { fps } = useVideoConfig();
  const { brief, copy, brand_config: brand } = contextPacket;
  const segments = resolveSegments(brief.segments, clipPaths, fps);

  const hookSeg = segments.find((s) => s.segment.type === 'hook');
  const bodySeg = segments.find((s) => s.segment.type === 'body');
  const ctaSeg = segments.find((s) => s.segment.type === 'cta');

  const transitionType = brand.transition_style as 'cut' | 'fade' | 'slide-left' | 'slide-up' | 'zoom' | 'wipe';

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* === Hook === */}
      {hookSeg && (
        <Sequence from={hookSeg.startFrame} durationInFrames={hookSeg.durationFrames}>
          <AbsoluteFill>
            <SegmentVideo segment={hookSeg} />
          </AbsoluteFill>
        </Sequence>
      )}

      {hookSeg && (
        <HookText
          text={hookSeg.segment.text_overlay.text}
          fontFamily={brand.font_family}
          fontSize={60}
          fontWeight={brand.font_weight_title}
          textColor="#FFFFFF"
          strokeColor="#000000"
          strokeWidth={3}
          position="center"
          animation={(hookSeg.segment.text_overlay.animation ?? 'pop-in') as 'pop-in' | 'slide-up' | 'typewriter' | 'scale-rotate' | 'glitch'}
          durationFrames={hookSeg.durationFrames}
          startFrame={hookSeg.startFrame}
        />
      )}

      {/* === Before/After Body === */}
      {bodySeg && (
        <Sequence from={bodySeg.startFrame} durationInFrames={bodySeg.durationFrames}>
          <TransformationBody
            segment={bodySeg}
            brand={brand}
            fps={fps}
          />
        </Sequence>
      )}

      {/* === CTA === */}
      {ctaSeg && (
        <>
          <Sequence from={ctaSeg.startFrame} durationInFrames={ctaSeg.durationFrames}>
            <AbsoluteFill>
              <SegmentVideo segment={ctaSeg} />
            </AbsoluteFill>
          </Sequence>
          <Sequence from={ctaSeg.startFrame} durationInFrames={ctaSeg.durationFrames}>
            <CTAScreen
              text={ctaSeg.segment.text_overlay.text}
              fontFamily={brand.font_family}
              style={brand.cta_style as 'link-in-bio' | 'swipe-up' | 'follow' | 'shop-now' | 'minimal'}
              textColor={brand.cta_text_color ?? '#FFFFFF'}
              accentColor={brand.secondary_color}
              durationFrames={ctaSeg.durationFrames}
              brandName={brand.brand_name}
            />
          </Sequence>
        </>
      )}

      {/* === Captions === */}
      {bodySeg && transcriptions[bodySeg.segment.segment_id] && (
        <CaptionTrack
          words={transcriptions[bodySeg.segment.segment_id]}
          preset={brand.caption_preset}
          startFrom={bodySeg.startFrame}
        />
      )}

      {/* === Transitions === */}
      {segments.slice(1).map((seg) => (
        <TransitionEffect
          key={`trans-${seg.segment.segment_id}`}
          type={transitionType}
          startFrame={seg.startFrame - 4}
          durationFrames={8}
          color={brand.primary_color}
        />
      ))}

      {/* === Logo === */}
      {logoPath && (
        <LogoWatermark
          logoSrc={logoPath}
          position={brand.watermark_position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'}
          opacity={brand.watermark_opacity}
          size={50}
        />
      )}

      {/* === Music === */}
      {musicPath && (
        <Audio
          src={musicPath}
          volume={brief.audio.background_music.volume_level}
          startFrom={0}
        />
      )}
    </AbsoluteFill>
  );
};

/** Before/After body with split-wipe reveal */
import type { ResolvedSegment } from '../types.js';
import type { BrandConfig } from '../../types/database.js';

const TransformationBody: React.FC<{
  segment: ResolvedSegment;
  brand: BrandConfig;
  fps: number;
}> = ({ segment, brand, fps }) => {
  const frame = useCurrentFrame();
  const totalFrames = segment.durationFrames;
  const clips = Array.isArray(segment.clipPath) ? segment.clipPath : [segment.clipPath];
  const subSegs = segment.segment.sub_segments;

  // If we have sub_segments with "before" and "after" labels, use split reveal
  const hasTwoParts = clips.length >= 2 || (subSegs && subSegs.length >= 2);

  if (!hasTwoParts) {
    // Fallback: just show the video with text overlays
    return (
      <AbsoluteFill>
        <SegmentVideo segment={segment} />
        {subSegs?.map((sub, i) => {
          const subFrames = Math.round(sub.duration * fps);
          const subStart = i === 0 ? 0 : Math.round(subSegs.slice(0, i).reduce((s, ss) => s + ss.duration, 0) * fps);
          return (
            <Sequence key={i} from={subStart} durationInFrames={subFrames}>
              <BeforeAfterLabel
                text={sub.text_overlay.text}
                fontFamily={brand.font_family}
                accentColor={brand.secondary_color}
                fps={fps}
              />
            </Sequence>
          );
        })}
      </AbsoluteFill>
    );
  }

  // Split reveal: "before" fills screen, then wipes to reveal "after"
  const revealPoint = Math.floor(totalFrames * 0.5); // reveal at 50%
  const revealProgress = interpolate(frame, [revealPoint - 10, revealPoint + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const beforeClip = clips[0];
  const afterClip = clips.length >= 2 ? clips[1] : clips[0];

  return (
    <AbsoluteFill>
      {/* Before */}
      <AbsoluteFill style={{ clipPath: `inset(0 ${revealProgress * 100}% 0 0)` }}>
        {beforeClip && (
          <video
            src={beforeClip}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
          />
        )}
      </AbsoluteFill>

      {/* After */}
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${(1 - revealProgress) * 100}%)` }}>
        {afterClip && (
          <video
            src={afterClip}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
          />
        )}
      </AbsoluteFill>

      {/* Divider line */}
      {revealProgress > 0 && revealProgress < 1 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${(1 - revealProgress) * 100}%`,
            width: 4,
            height: '100%',
            backgroundColor: brand.secondary_color,
            zIndex: 10,
            boxShadow: `0 0 20px ${brand.secondary_color}`,
          }}
        />
      )}

      {/* Before/After labels */}
      {frame < revealPoint && (
        <BeforeAfterLabel
          text={subSegs?.[0]?.text_overlay.text ?? 'BEFORE'}
          fontFamily={brand.font_family}
          accentColor={brand.secondary_color}
          fps={fps}
        />
      )}
      {frame >= revealPoint && (
        <BeforeAfterLabel
          text={subSegs?.[1]?.text_overlay.text ?? 'AFTER'}
          fontFamily={brand.font_family}
          accentColor={brand.secondary_color}
          fps={fps}
        />
      )}
    </AbsoluteFill>
  );
};

const BeforeAfterLabel: React.FC<{
  text: string;
  fontFamily: string;
  accentColor: string;
  fps: number;
}> = ({ text, fontFamily, accentColor, fps }) => {
  const frame = useCurrentFrame();
  const entrance = spring({ frame, fps, config: { damping: 12, stiffness: 200, mass: 0.4 } });

  return (
    <div
      style={{
        position: 'absolute',
        top: '10%',
        left: 0,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 15,
        opacity: entrance,
        transform: `translateY(${interpolate(entrance, [0, 1], [20, 0])}px)`,
      }}
    >
      <div
        style={{
          backgroundColor: accentColor,
          borderRadius: 8,
          padding: '8px 24px',
        }}
      >
        <span
          style={{
            fontFamily,
            fontSize: 32,
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};
