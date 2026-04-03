import React from 'react';
import { AbsoluteFill, Sequence, Audio, useVideoConfig, spring, useCurrentFrame, interpolate } from 'remotion';
import type { TemplateProps } from '../types.js';
import { resolveSegments } from '../types.js';
import { SegmentVideo } from '../components/SegmentVideo.js';
import { HookText } from '../components/HookText.js';
import { CTAScreen } from '../components/CTAScreen.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { LogoWatermark } from '../components/LogoWatermark.js';
import { TransitionEffect } from '../components/TransitionEffect.js';

/**
 * Hook → Listicle (3-5 tips with numbered overlays) → CTA
 * Best for: educational content, tips, how-tos, listicles.
 *
 * The body segment is broken into sub-segments, each with a numbered
 * text overlay that animates in with a progress indicator.
 */
export const HookListicleCTA: React.FC<TemplateProps> = ({
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

  const subSegments = bodySeg?.segment.sub_segments ?? [];
  const totalItems = subSegments.length;
  const transitionType = brand.transition_style as 'cut' | 'fade' | 'slide-left' | 'slide-up' | 'zoom' | 'wipe';

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* === Video Layers === */}
      {segments.map((seg) => (
        <Sequence
          key={seg.segment.segment_id}
          from={seg.startFrame}
          durationInFrames={seg.durationFrames}
        >
          <AbsoluteFill>
            <SegmentVideo segment={seg} />
          </AbsoluteFill>
        </Sequence>
      ))}

      {/* === Hook Text === */}
      {hookSeg && (
        <HookText
          text={hookSeg.segment.text_overlay.text}
          fontFamily={brand.font_family}
          fontSize={60}
          fontWeight={brand.font_weight_title}
          textColor="#FFFFFF"
          strokeColor="#000000"
          strokeWidth={3}
          position={hookSeg.segment.text_overlay.position as 'center' | 'top' | 'bottom'}
          animation={(hookSeg.segment.text_overlay.animation ?? 'pop-in') as 'pop-in' | 'slide-up' | 'typewriter' | 'scale-rotate' | 'glitch'}
          durationFrames={hookSeg.durationFrames}
          startFrame={hookSeg.startFrame}
        />
      )}

      {/* === Listicle Items (numbered, with progress bar) === */}
      {bodySeg && subSegments.length > 0 && (() => {
        let subOffset = bodySeg.startFrame;
        return subSegments.map((sub, i) => {
          const subFrames = Math.round(sub.duration * fps);
          const start = subOffset;
          subOffset += subFrames;
          return (
            <Sequence key={`list-${i}`} from={start} durationInFrames={subFrames}>
              <ListicleItem
                text={sub.text_overlay.text}
                itemNumber={i + 1}
                totalItems={totalItems}
                fontFamily={brand.font_family}
                accentColor={brand.secondary_color}
                durationFrames={subFrames}
                fps={fps}
              />
            </Sequence>
          );
        });
      })()}

      {/* === CTA Screen === */}
      {ctaSeg && (
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

/** Individual listicle item with number badge and progress bar */
const ListicleItem: React.FC<{
  text: string;
  itemNumber: number;
  totalItems: number;
  fontFamily: string;
  accentColor: string;
  durationFrames: number;
  fps: number;
}> = ({ text, itemNumber, totalItems, fontFamily, accentColor, durationFrames, fps }) => {
  const frame = useCurrentFrame();

  const entrance = spring({ frame, fps, config: { damping: 14, stiffness: 180, mass: 0.5 } });

  // Progress bar fills over the item's duration
  const progress = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Exit
  const exitOpacity = interpolate(frame, [durationFrames - 5, durationFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: '8%',
        left: 0,
        width: '100%',
        padding: '0 6%',
        zIndex: 20,
        opacity: entrance * exitOpacity,
        transform: `translateY(${interpolate(entrance, [0, 1], [30, 0])}px)`,
      }}
    >
      {/* Number badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: accentColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${interpolate(entrance, [0, 1], [0.3, 1])})`,
          }}
        >
          <span style={{ fontFamily, fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>
            {itemNumber}
          </span>
        </div>

        {/* Step counter */}
        <span style={{ fontFamily, fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em' }}>
          {itemNumber} / {totalItems}
        </span>
      </div>

      {/* Text */}
      <p
        style={{
          fontFamily,
          fontSize: 40,
          fontWeight: 700,
          color: '#FFFFFF',
          margin: 0,
          lineHeight: 1.15,
          textShadow: '0 3px 12px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)',
          letterSpacing: '-0.02em',
          maxWidth: '90%',
        }}
      >
        {text}
      </p>

      {/* Progress bar */}
      <div
        style={{
          marginTop: 16,
          height: 4,
          backgroundColor: 'rgba(255,255,255,0.15)',
          borderRadius: 2,
          width: '60%',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            backgroundColor: accentColor,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
};
