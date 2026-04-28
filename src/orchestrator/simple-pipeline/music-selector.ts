/**
 * Simple Pipeline music selector — thin wrapper over the existing
 * `selectMusicTrack` (src/lib/music-selector.ts).
 *
 * Per brief: no new selection algorithm. Same brand-allowed pool. The
 * existing function does weighted-random by used_count within a single
 * mood query and falls back to mood-agnostic if the mood query is empty.
 *
 * This wrapper:
 *   - Maps format → preferred mood + energy range (heuristic; tunable
 *     via env if iteration becomes necessary)
 *   - Computes minDurationS from format + caller-supplied segment context
 *   - Delegates to selectMusicTrack, which handles the fallback cascade
 *     and used_count increment
 *
 * Brand-allowed restriction: brand_configs does not currently have an
 * `allowed_music_intents` / `allowed_music_moods` column. All tracks in
 * the global music_tracks library are available to any brand. If a per-
 * brand pool becomes necessary, add a column + filter here. Tracked under
 * followup `w9-music-library-needs-expansion`.
 *
 * Music-track active state: per Q10 / pre-work check, music_tracks has no
 * `active` column. All rows are treated as live.
 *
 * File: src/orchestrator/simple-pipeline/music-selector.ts
 */

import { selectMusicTrack, type MusicSelection } from '../../lib/music-selector.js';

export type SimplePipelineFormat = 'routine' | 'meme';

export interface MusicSelectorInput {
  brandId: string;
  format: SimplePipelineFormat;
  /** Total expected video duration in seconds (music must be ≥ this). */
  minDurationS: number;
}

interface FormatMusicPreference {
  mood: string;
  energyRange: [number, number];
}

const FORMAT_PREFERENCES: Record<SimplePipelineFormat, FormatMusicPreference> = {
  // Routine: instructional, warm, supportive — chill mood, mid-low energy.
  // Falls back to any-mood mid-low-energy if no chill tracks fit.
  routine: { mood: 'chill', energyRange: [3, 7] },

  // Meme: punchy, expressive — playful mood, mid-high energy.
  // Falls back to any-mood mid-high-energy if no playful tracks fit.
  meme: { mood: 'playful', energyRange: [5, 9] },
};

/** Safety margin added to minDurationS to ensure music has tail. */
const MIN_DURATION_BUFFER_S = 2;

export async function selectMusicForSimplePipeline(
  input: MusicSelectorInput,
): Promise<MusicSelection | null> {
  if (!input.brandId.trim()) throw new Error('selectMusicForSimplePipeline: brandId is required');
  if (input.minDurationS <= 0) {
    throw new Error(`selectMusicForSimplePipeline: minDurationS must be > 0, got ${input.minDurationS}`);
  }

  const pref = FORMAT_PREFERENCES[input.format];
  return await selectMusicTrack({
    mood: pref.mood,
    energyRange: pref.energyRange,
    minDuration: input.minDurationS + MIN_DURATION_BUFFER_S,
    brandId: input.brandId,
  });
}
