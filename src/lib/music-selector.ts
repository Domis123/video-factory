/**
 * Music track selection for video production.
 *
 * Selects the best music track from the library based on:
 * - Mood match to the video type's requirements
 * - Energy level within the video type's range
 * - Sufficient duration (>= video target)
 * - Weighted random to favor fresh tracks (lower used_count)
 */

import { supabaseAdmin } from '../config/supabase.js';
import type { MusicTrack } from '../types/database.js';

export interface MusicSelection {
  track: MusicTrack;
  /** Why this track was selected */
  rationale: string;
}

/**
 * Select a music track for a video.
 * Returns null if no tracks match or library is empty.
 */
export async function selectMusicTrack(opts: {
  mood: string;
  energyRange: [number, number];
  minDuration: number;
  brandId?: string;
}): Promise<MusicSelection | null> {
  const { mood, energyRange, minDuration } = opts;

  // Query tracks matching mood + energy range + sufficient duration
  const { data: tracks, error } = await supabaseAdmin
    .from('music_tracks')
    .select('*')
    .eq('mood', mood)
    .gte('energy_level', energyRange[0])
    .lte('energy_level', energyRange[1])
    .gte('duration_seconds', minDuration)
    .order('used_count', { ascending: true })
    .limit(20);

  if (error) {
    console.warn(`[music-selector] Query error: ${error.message}`);
    return null;
  }

  if (!tracks || tracks.length === 0) {
    // Fallback: try any mood track with right energy and duration
    const { data: fallbackTracks } = await supabaseAdmin
      .from('music_tracks')
      .select('*')
      .gte('energy_level', energyRange[0])
      .lte('energy_level', energyRange[1])
      .gte('duration_seconds', minDuration)
      .order('used_count', { ascending: true })
      .limit(10);

    if (!fallbackTracks || fallbackTracks.length === 0) {
      console.log(`[music-selector] No tracks found for mood=${mood}, energy=${energyRange}, minDuration=${minDuration}s`);
      return null;
    }

    const selected = weightedRandom(fallbackTracks as MusicTrack[]);
    return {
      track: selected,
      rationale: `Fallback: energy match (${selected.energy_level}), mood ${selected.mood} instead of ${mood}`,
    };
  }

  const selected = weightedRandom(tracks as MusicTrack[]);

  // Increment used_count
  await supabaseAdmin
    .from('music_tracks')
    .update({ used_count: selected.used_count + 1 })
    .eq('id', selected.id);

  return {
    track: selected,
    rationale: `Mood: ${selected.mood}, Energy: ${selected.energy_level}, BPM: ${selected.tempo_bpm}, Used: ${selected.used_count}x`,
  };
}

/**
 * Weighted random selection — fresher tracks (lower used_count) are preferred.
 * Weight = 1 / (used_count + 1) so a never-used track has weight 1,
 * a track used 3 times has weight 0.25.
 */
function weightedRandom(tracks: MusicTrack[]): MusicTrack {
  const weights = tracks.map(t => 1 / (t.used_count + 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let rand = Math.random() * totalWeight;
  for (let i = 0; i < tracks.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return tracks[i];
  }

  return tracks[tracks.length - 1];
}
