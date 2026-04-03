import { join } from 'node:path';
import { env } from '../config/env.js';
import { downloadToFile } from '../lib/r2-storage.js';
import { buildAudioMixCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import type { ContextPacket } from '../types/database.js';

export interface AudioMixResult {
  outputPath: string;
  musicTrackR2Key: string | null;
  musicVolume: number;
}

export async function mixAudio(
  jobId: string,
  videoPath: string,
  contextPacket: ContextPacket,
): Promise<AudioMixResult> {
  const workDir = join(env.RENDER_TEMP_DIR, jobId);
  const outputPath = join(workDir, 'mixed.mp4');

  const musicSelection = contextPacket.music_selection;

  // No background music requested
  if (!musicSelection) {
    console.log(`[audio-mixer] No background music for job ${jobId}, copying video as-is`);
    await execOrThrow({
      command: 'cp',
      args: [videoPath, outputPath],
    });
    return { outputPath, musicTrackR2Key: null, musicVolume: 0 };
  }

  // Download music track from R2
  const musicLocalPath = join(workDir, 'music.mp3');
  console.log(`[audio-mixer] Downloading music: ${musicSelection.r2_key}`);
  await downloadToFile(musicSelection.r2_key, musicLocalPath);

  // Mix: UGC audio (full volume) + background music (ducked)
  const volume = musicSelection.volume_level ?? 0.15;
  console.log(`[audio-mixer] Mixing audio with music at volume ${volume}`);
  await execOrThrow(buildAudioMixCommand(videoPath, musicLocalPath, outputPath, volume));

  console.log(`[audio-mixer] Audio mixed: ${outputPath}`);
  return {
    outputPath,
    musicTrackR2Key: musicSelection.r2_key,
    musicVolume: volume,
  };
}
