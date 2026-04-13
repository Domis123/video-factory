import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import type { BrandConfig, CreativeBrief, ClipSelectionList, CopyPackage, ContextPacket, MusicTrack } from '../types/database.js';
import { generateBrief } from './creative-director.js';
import { curateAssets } from './asset-curator-dispatch.js';
import { generateCopy } from './copywriter.js';
import { selectMusicTrack } from '../lib/music-selector.js';
import { buildTemplateConfig } from '../lib/template-config-builder.js';
import { VIDEO_TYPE_CONFIGS, type VideoType } from '../types/video-types.js';

export interface PlanningInput {
  ideaSeed: string;
  brandConfig: BrandConfig;
}

/** Run all 3 agents and merge into an immutable Context Packet */
export async function buildContextPacket(input: PlanningInput): Promise<ContextPacket> {
  console.log('[context-packet] Starting planning pipeline...');

  // Agent 1: Creative Director → Brief
  console.log('[context-packet] Agent 1: Creative Director...');
  const brief = await generateBrief({
    ideaSeed: input.ideaSeed,
    brandConfig: input.brandConfig,
  });
  console.log(`[context-packet] Brief created: ${brief.template_id}, ${brief.total_duration_target}s, ${brief.segments.length} segments`);

  // Agent 2: Asset Curator → Clip Selections
  console.log('[context-packet] Agent 2: Asset Curator...');
  const clips = await curateAssets({ brief }, input.brandConfig.brand_id);
  // Claude varies the wrapper key name across runs — observed so far:
  // `clip_selections`, `selections`, `segments`. The array contents are
  // always structurally valid (each item has a `segment_id`). Instead of
  // chasing key names, scan the top-level object for ANY array-valued
  // property whose first item has a `segment_id` and treat that as the
  // canonical clip-selection list.
  const curatorBag = clips as unknown as Record<string, unknown>;
  const foundArray = Object.values(curatorBag).find(
    (v): v is unknown[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === 'object' &&
      v[0] !== null &&
      'segment_id' in (v[0] as object),
  );
  const clipSelections = (foundArray ?? []) as ClipSelectionList['clip_selections'];
  if (!clipSelections.length) {
    throw new Error(
      'Asset Curator returned no clip selections: ' + JSON.stringify(clips),
    );
  }
  clips.clip_selections = clipSelections;
  console.log(`[context-packet] Clips selected: ${clipSelections.length} segments covered`);

  // Agent 3: Copywriter → Copy Package
  console.log('[context-packet] Agent 3: Copywriter...');
  const copy = await generateCopy({ brief, brandConfig: input.brandConfig });
  console.log(`[context-packet] Copy generated: ${copy.overlays.length} overlays, ${copy.hook_variants.length} hook variants`);

  // Music selection — gated on ENABLE_MUSIC_SELECTION (off for MVP).
  // MVP path: fetch a single track by FALLBACK_MUSIC_TRACK_ID and use it verbatim.
  // Full path: weighted random by mood + video type's energy range.
  let musicSelection: ContextPacket['music_selection'] = null;
  if (env.ENABLE_MUSIC_SELECTION) {
    const vtConfig = VIDEO_TYPE_CONFIGS[brief.video_type as VideoType];
    if (vtConfig) {
      console.log('[context-packet] Selecting music track (weighted random)...');
      const musicResult = await selectMusicTrack({
        mood: brief.audio.background_music.mood,
        energyRange: vtConfig.music_energy_range,
        minDuration: brief.total_duration_target,
        brandId: input.brandConfig.brand_id,
      });

      if (musicResult) {
        console.log(`[context-packet] Music selected: ${musicResult.track.title ?? musicResult.track.id} (${musicResult.rationale})`);
        musicSelection = {
          track_id: musicResult.track.id,
          r2_key: musicResult.track.r2_key,
          volume_level: brief.audio.background_music.volume_level,
        };
      } else {
        console.log('[context-packet] No matching music track found — continuing without background music');
      }
    }
  } else if (env.FALLBACK_MUSIC_TRACK_ID) {
    console.log(`[context-packet] Music selection flagged off — using fallback track ${env.FALLBACK_MUSIC_TRACK_ID}`);
    const { data: fallbackTrack, error: fallbackErr } = await supabaseAdmin
      .from('music_tracks')
      .select('*')
      .eq('id', env.FALLBACK_MUSIC_TRACK_ID)
      .single();
    if (fallbackErr || !fallbackTrack) {
      console.warn(`[context-packet] Fallback track ${env.FALLBACK_MUSIC_TRACK_ID} not found: ${fallbackErr?.message ?? 'no row'} — continuing without music`);
    } else {
      const track = fallbackTrack as MusicTrack;
      musicSelection = {
        track_id: track.id,
        r2_key: track.r2_key,
        volume_level: brief.audio.background_music.volume_level,
      };
      console.log(`[context-packet] Fallback track loaded: ${track.title ?? track.id}`);
    }
  } else {
    console.log('[context-packet] Music selection flagged off and no FALLBACK_MUSIC_TRACK_ID — continuing without music');
  }

  // Template config — gated on ENABLE_DYNAMIC_PACING. When off, every segment
  // uses its layout's hard-coded default timings, matching current MVP behavior.
  // Beat-sync is also gated (ENABLE_BEAT_SYNC) but is dormant today: beat map is
  // never built in the render pipeline, so the flag is defined for symmetry with v3.
  let templateConfig: Record<string, unknown> = {};
  if (env.ENABLE_DYNAMIC_PACING) {
    const built = buildTemplateConfig(brief.segments, null); // beat map wired in later when ENABLE_BEAT_SYNC=true
    console.log(`[context-packet] Template config: speed=${built.global_animation_speed}, ${built.segments.length} segment configs`);
    templateConfig = built as unknown as Record<string, unknown>;
  } else {
    console.log('[context-packet] Dynamic pacing flagged off — template_config = {}');
  }

  // Merge into Context Packet
  const contextPacket: ContextPacket = {
    context_packet_id: randomUUID(),
    brief,
    clips,
    copy,
    brand_config: input.brandConfig,
    template_config: templateConfig,
    music_selection: musicSelection,
    created_at: new Date().toISOString(),
  };

  console.log(`[context-packet] Context Packet assembled: ${contextPacket.context_packet_id}`);
  return contextPacket;
}

/** Run planning and store Context Packet in the job record */
export async function planJob(jobId: string, input: PlanningInput): Promise<ContextPacket> {
  const contextPacket = await buildContextPacket(input);

  // Store in job
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({
      context_packet: contextPacket as unknown as Record<string, unknown>,
      video_type: contextPacket.brief.video_type,
      template_id: contextPacket.brief.template_id,
      hook_text: contextPacket.copy.hook_variants[0]?.text ?? null,
      cta_text: contextPacket.brief.segments.find((s) => s.type === 'cta')?.text_overlay.text ?? null,
      brief_summary: `${contextPacket.brief.video_type} | ${contextPacket.brief.template_id} | ${contextPacket.brief.total_duration_target}s | ${contextPacket.brief.segments.length} segments`,
      clip_selections: contextPacket.clips as unknown as Record<string, unknown>,
      copy_package: contextPacket.copy as unknown as Record<string, unknown>,
    })
    .eq('id', jobId);

  if (error) throw new Error(`Failed to store context packet: ${error.message}`);

  console.log(`[context-packet] Stored in job ${jobId}`);
  return contextPacket;
}
