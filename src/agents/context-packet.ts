import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import type { BrandConfig, CreativeBrief, ClipSelectionList, CopyPackage, ContextPacket } from '../types/database.js';
import { generateBrief } from './creative-director.js';
import { selectClips } from './asset-curator.js';
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
  const clips = await selectClips({ brief });
  console.log(`[context-packet] Clips selected: ${clips.clip_selections.length} segments covered`);

  // Agent 3: Copywriter → Copy Package
  console.log('[context-packet] Agent 3: Copywriter...');
  const copy = await generateCopy({ brief, brandConfig: input.brandConfig });
  console.log(`[context-packet] Copy generated: ${copy.overlays.length} overlays, ${copy.hook_variants.length} hook variants`);

  // Music selection — uses video type's music energy range and brief's mood
  let musicSelection: ContextPacket['music_selection'] = null;
  const vtConfig = VIDEO_TYPE_CONFIGS[brief.video_type as VideoType];
  if (vtConfig) {
    console.log('[context-packet] Selecting music track...');
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

  // Build template config (dynamic pacing from energy curve + beat map)
  const templateConfig = buildTemplateConfig(brief.segments, null); // beat map added at render time when music is downloaded
  console.log(`[context-packet] Template config: speed=${templateConfig.global_animation_speed}, ${templateConfig.segments.length} segment configs`);

  // Merge into Context Packet
  const contextPacket: ContextPacket = {
    context_packet_id: randomUUID(),
    brief,
    clips,
    copy,
    brand_config: input.brandConfig,
    template_config: templateConfig as unknown as Record<string, unknown>,
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
