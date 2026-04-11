import React from 'react';
import { AbsoluteFill, Sequence, Audio, staticFile, useVideoConfig } from 'remotion';
import type { TemplateProps } from '../types.js';
import { resolveSegments, totalFrames } from '../types.js';
import { SegmentVideo } from '../components/SegmentVideo.js';
import { HookText } from '../components/HookText.js';
import { CTAScreen } from '../components/CTAScreen.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { LogoWatermark } from '../components/LogoWatermark.js';
import { TransitionEffect } from '../components/TransitionEffect.js';

/**
 * Hook → Product Demo → CTA
 * Best for: product showcases, demonstrations, tutorials.
 *
 * Structure:
 * - Hook: bold text + attention-grabbing clip (1-3s)
 * - Body: product demo footage with captions and overlays
 * - CTA: branded end screen with action prompt
 */
export const HookDemoCTA: React.FC<TemplateProps> = ({
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

      {/* === Hook Text Overlay === */}
      {hookSeg && (
        <HookText
          text={hookSeg.segment.text_overlay.text}
          fontFamily={brand.font_family}
          fontSize={60}
          fontWeight={brand.font_weight_title}
          textColor={brand.primary_color === '#1a1a2e' ? '#FFFFFF' : brand.primary_color}
          strokeColor="#000000"
          strokeWidth={3}
          position={hookSeg.segment.text_overlay.position as 'center' | 'top' | 'bottom'}
          animation={(hookSeg.segment.text_overlay.animation ?? 'pop-in') as 'pop-in' | 'slide-up' | 'typewriter' | 'scale-rotate' | 'glitch'}
          durationFrames={hookSeg.durationFrames}
          startFrame={hookSeg.startFrame}
        />
      )}

      {/* === Body Text Overlays === */}
      {bodySeg?.segment.sub_segments && (() => {
        let subOffset = bodySeg.startFrame;
        return bodySeg.segment.sub_segments.map((sub, i) => {
          const subFrames = Math.round(sub.duration * fps);
          const start = subOffset;
          subOffset += subFrames;
          return (
            <HookText
              key={`body-overlay-${i}`}
              text={sub.text_overlay.text}
              fontFamily={brand.font_family}
              fontSize={44}
              fontWeight={brand.font_weight_body}
              textColor="#FFFFFF"
              strokeColor="#000000"
              strokeWidth={2}
              position="top"
              animation="slide-up"
              durationFrames={subFrames}
              startFrame={start}
            />
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
            bgColor={brand.cta_bg_color ?? undefined}
            textColor={brand.cta_text_color ?? '#FFFFFF'}
            accentColor={brand.secondary_color}
            durationFrames={ctaSeg.durationFrames}
            brandName={brand.brand_name}
          />
        </Sequence>
      )}

      {/* === Captions (word-by-word from whisper) === */}
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

      {/* === Logo Watermark === */}
      {logoPath && (
        <LogoWatermark
          logoSrc={logoPath}
          position={brand.watermark_position as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'}
          opacity={brand.watermark_opacity}
          size={50}
        />
      )}

      {/* === Background Music === */}
      {musicPath && (
        <Audio
          src={staticFile(musicPath)}
          volume={brief.audio.background_music.volume_level}
          startFrom={0}
        />
      )}
    </AbsoluteFill>
  );
};
