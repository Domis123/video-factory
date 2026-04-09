/**
 * Beat detection and beat-snapping utilities.
 * Computes beat positions from tempo_bpm and provides helpers
 * for snapping transition frames to the nearest beat.
 */

import { exec } from './exec.js';
import type { FfCommand } from './ffmpeg.js';

export interface BeatMap {
  /** Beats per minute of the track */
  tempo_bpm: number;
  /** Offset of first beat in seconds */
  first_beat_offset: number;
  /** Pre-computed beat positions in seconds */
  beat_positions: number[];
  /** Track duration in seconds */
  duration: number;
}

/**
 * Build a BeatMap from a music track.
 * Uses tempo_bpm from database + FFmpeg silence detection to find first beat.
 */
export async function buildBeatMap(
  musicPath: string,
  tempoBpm: number,
  durationSeconds: number,
): Promise<BeatMap> {
  const firstBeatOffset = await detectFirstBeat(musicPath);
  const beatInterval = 60 / tempoBpm;

  // Pre-compute all beat positions
  const beatPositions: number[] = [];
  let pos = firstBeatOffset;
  while (pos < durationSeconds) {
    beatPositions.push(Math.round(pos * 1000) / 1000); // round to ms
    pos += beatInterval;
  }

  console.log(`[beat-detector] ${tempoBpm} BPM, first beat at ${firstBeatOffset.toFixed(3)}s, ${beatPositions.length} beats in ${durationSeconds}s`);

  return {
    tempo_bpm: tempoBpm,
    first_beat_offset: firstBeatOffset,
    beat_positions: beatPositions,
    duration: durationSeconds,
  };
}

/**
 * Detect the first beat by finding the end of initial silence.
 * Uses FFmpeg silencedetect to find when audio first becomes audible.
 */
async function detectFirstBeat(musicPath: string): Promise<number> {
  try {
    const cmd: FfCommand = {
      command: 'ffmpeg',
      args: [
        '-i', musicPath,
        '-af', 'silencedetect=noise=-30dB:d=0.1',
        '-f', 'null',
        '-t', '5', // only analyze first 5 seconds
        '-',
      ],
    };

    const result = await exec(cmd);
    const output = result.stderr;

    // Look for silence_end which marks where audio begins
    const match = output.match(/silence_end:\s*([\d.]+)/);
    if (match) {
      return parseFloat(match[1]);
    }

    // No silence detected = audio starts immediately
    return 0;
  } catch {
    console.warn('[beat-detector] First beat detection failed, assuming 0');
    return 0;
  }
}

/**
 * Snap a time (in seconds) to the nearest beat position.
 * Returns the snapped time. If no beat map, returns the original time.
 */
export function snapToNearestBeat(timeSeconds: number, beatMap: BeatMap | null): number {
  if (!beatMap || beatMap.beat_positions.length === 0) return timeSeconds;

  let closest = beatMap.beat_positions[0];
  let minDist = Math.abs(timeSeconds - closest);

  for (const beat of beatMap.beat_positions) {
    const dist = Math.abs(timeSeconds - beat);
    if (dist < minDist) {
      minDist = dist;
      closest = beat;
    }
    // Beats are sorted, so once distance starts increasing we can stop
    if (beat > timeSeconds + minDist) break;
  }

  return closest;
}

/**
 * Snap a frame number to the nearest beat-aligned frame.
 */
export function snapFrameToNearestBeat(
  frame: number,
  fps: number,
  beatMap: BeatMap | null,
): number {
  if (!beatMap) return frame;
  const timeSeconds = frame / fps;
  const snappedTime = snapToNearestBeat(timeSeconds, beatMap);
  return Math.round(snappedTime * fps);
}
