import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import type { BrandConfig, ClipSelectionList, ContextPacket, Phase3ContextPacket, MusicTrack } from '../types/database.js';
import { generateBriefDispatched } from './creative-director-dispatch.js';
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
export async function buildContextPacket(input: PlanningInput): Promise<ContextPacket | Phase3ContextPacket> {
  console.log('[context-packet] Starting planning pipeline...');

  // Agent 1: Creative Director → Brief (dispatcher routes by ENABLE_PHASE_3_CD)
  console.log('[context-packet] Agent 1: Creative Director...');
  const dispatched = await generateBriefDispatched({
    ideaSeed: input.ideaSeed,
    brandConfig: input.brandConfig,
  });

  if (dispatched.phase === 'phase3') {
    const p3Brief = dispatched.brief;
    console.log(
      `[context-packet] Phase 3 brief: ${p3Brief.video_type}, ` +
      `${p3Brief.total_duration_target}s, ${p3Brief.segments.length} segments, ` +
      `slot_count=${p3Brief.creative_direction.slot_count}, ` +
      `color=${p3Brief.creative_direction.color_treatment}`,
    );

    // Agent 2: Asset Curator (W2 — reads creative_vision + aesthetic_guidance)
    console.log('[context-packet] Agent 2: Asset Curator (Phase 3)...');
    const clips = await curateAssets({ brief: p3Brief }, input.brandConfig.brand_id);
    const clipSelections = extractClipSelections(clips);
    clips.clip_selections = clipSelections;
    console.log(`[context-packet] Clips selected: ${clipSelections.length} segments covered`);

    // Architecture pivot: fetch the actual descriptions of the picked segments so
    // the copywriter can write text that matches what is on screen.
    const selectedClipDescriptions = await fetchSelectedClipDescriptions(clipSelections);
    console.log(
      `[context-packet] Loaded clip descriptions for ${selectedClipDescriptions.filter(Boolean).length}/${clipSelections.length} slots`,
    );

    // Agent 3: Copywriter (W3 — authors overlay text from constraints + actual clips)
    console.log('[context-packet] Agent 3: Copywriter (Phase 3)...');
    const copy = await generateCopy({
      brief: p3Brief,
      brandConfig: input.brandConfig,
      selectedClipDescriptions,
    });
    console.log(`[context-packet] Copy generated: ${copy.overlays.length} overlays, ${copy.hook_variants.length} hook variants`);

    // Music selection
    const musicSelection = await selectMusic(p3Brief.audio.music.mood, p3Brief.video_type, p3Brief.total_duration_target, p3Brief.audio.music.volume_level, input.brandConfig.brand_id);

    const contextPacket: Phase3ContextPacket = {
      context_packet_id: randomUUID(),
      brief: p3Brief,
      clips,
      copy,
      brand_config: input.brandConfig,
      template_config: {},
      music_selection: musicSelection,
      created_at: new Date().toISOString(),
    };

    console.log(`[context-packet] Phase 3 Context Packet assembled: ${contextPacket.context_packet_id}`);
    return contextPacket;
  }

  const brief = dispatched.brief;
  console.log(`[context-packet] Brief created: ${brief.template_id}, ${brief.total_duration_target}s, ${brief.segments.length} segments`);

  // Agent 2: Asset Curator → Clip Selections
  console.log('[context-packet] Agent 2: Asset Curator...');
  const clips = await curateAssets({ brief }, input.brandConfig.brand_id);
  const clipSelections = extractClipSelections(clips);
  clips.clip_selections = clipSelections;
  console.log(`[context-packet] Clips selected: ${clipSelections.length} segments covered`);

  // Agent 3: Copywriter → Copy Package
  console.log('[context-packet] Agent 3: Copywriter...');
  const copy = await generateCopy({ brief, brandConfig: input.brandConfig });
  console.log(`[context-packet] Copy generated: ${copy.overlays.length} overlays, ${copy.hook_variants.length} hook variants`);

  // Music selection
  const musicSelection = await selectMusic(brief.audio.background_music.mood, brief.video_type, brief.total_duration_target, brief.audio.background_music.volume_level, input.brandConfig.brand_id);

  // Template config
  let templateConfig: Record<string, unknown> = {};
  if (env.ENABLE_DYNAMIC_PACING) {
    const built = buildTemplateConfig(brief.segments, null);
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

/**
 * Look up the picked segment's description by asset_segment_id, indexed by slot.
 * Returns one entry per slot (in order); slots whose pick lacks an
 * asset_segment_id, or whose segment row is missing, return null.
 *
 * The copywriter uses these to write text that matches what's on screen.
 */
async function fetchSelectedClipDescriptions(
  selections: ClipSelectionList['clip_selections'],
): Promise<(string | null)[]> {
  const segmentIds = selections
    .map((s) => s.asset_segment_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (segmentIds.length === 0) {
    return selections.map(() => null);
  }

  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, description')
    .in('id', segmentIds);

  if (error) {
    console.warn(`[context-packet] Failed to fetch clip descriptions: ${error.message} — copywriter will run without them`);
    return selections.map(() => null);
  }

  const descById = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.id && typeof row.description === 'string') {
      descById.set(row.id, row.description);
    }
  }

  return selections.map((s) =>
    s.asset_segment_id ? descById.get(s.asset_segment_id) ?? null : null,
  );
}

function extractClipSelections(clips: ClipSelectionList): ClipSelectionList['clip_selections'] {
  const curatorBag = clips as unknown as Record<string, unknown>;
  const foundArray = Object.values(curatorBag).find(
    (v): v is unknown[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === 'object' &&
      v[0] !== null &&
      'segment_id' in (v[0] as object),
  );
  const selections = (foundArray ?? []) as ClipSelectionList['clip_selections'];
  if (!selections.length) {
    throw new Error('Asset Curator returned no clip selections: ' + JSON.stringify(clips));
  }
  return selections;
}

async function selectMusic(
  mood: string,
  videoType: string,
  minDuration: number,
  volumeLevel: number,
  brandId: string,
): Promise<ContextPacket['music_selection']> {
  if (env.ENABLE_MUSIC_SELECTION) {
    const vtConfig = VIDEO_TYPE_CONFIGS[videoType as VideoType];
    if (vtConfig) {
      console.log('[context-packet] Selecting music track (weighted random)...');
      const musicResult = await selectMusicTrack({
        mood,
        energyRange: vtConfig.music_energy_range,
        minDuration,
        brandId,
      });

      if (musicResult) {
        console.log(`[context-packet] Music selected: ${musicResult.track.title ?? musicResult.track.id} (${musicResult.rationale})`);
        return {
          track_id: musicResult.track.id,
          r2_key: musicResult.track.r2_key,
          volume_level: volumeLevel,
        };
      }
      console.log('[context-packet] No matching music track found — continuing without background music');
    }
    return null;
  }

  if (env.FALLBACK_MUSIC_TRACK_ID) {
    console.log(`[context-packet] Music selection flagged off — using fallback track ${env.FALLBACK_MUSIC_TRACK_ID}`);
    const { data: fallbackTrack, error: fallbackErr } = await supabaseAdmin
      .from('music_tracks')
      .select('*')
      .eq('id', env.FALLBACK_MUSIC_TRACK_ID)
      .single();
    if (fallbackErr || !fallbackTrack) {
      console.warn(`[context-packet] Fallback track ${env.FALLBACK_MUSIC_TRACK_ID} not found: ${fallbackErr?.message ?? 'no row'} — continuing without music`);
      return null;
    }
    const track = fallbackTrack as MusicTrack;
    console.log(`[context-packet] Fallback track loaded: ${track.title ?? track.id}`);
    return {
      track_id: track.id,
      r2_key: track.r2_key,
      volume_level: volumeLevel,
    };
  }

  console.log('[context-packet] Music selection flagged off and no FALLBACK_MUSIC_TRACK_ID — continuing without music');
  return null;
}
