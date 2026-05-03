// Pure command builders — no execution, no dependencies.
// Each returns { command, args } suitable for child_process.spawn.

export interface FfCommand {
  command: string;
  args: string[];
}

export function buildProbeCommand(inputPath: string): FfCommand {
  return {
    command: 'ffprobe',
    args: [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ],
  };
}

export function buildTrimCommand(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
): FfCommand {
  // c1.2.1.6: re-encode video on trim. Output-seek alone (c1.2.1.5) was
  // frame-accurate but exposed a closed-GOP edge case: when the requested
  // start landed before the first video keyframe of the relevant range,
  // -c copy dropped the video stream entirely (4/6 Gate A renders failed
  // with "Stream specifier ':v' matches no streams"). Re-encoding the
  // video forces ffmpeg to decode-and-emit every kept frame regardless
  // of GOP boundaries. Audio stream-copies because audio frames are
  // independent.
  //
  // Encoder params:
  //   - libx264 + preset medium + CRF 18: matches Pass C's quality target
  //     (Pass C uses CRF 18 slow; per-segment uses medium for ~3x faster
  //     encode at marginally larger filesize)
  //   - AAC 192k 44100: matches buildNormalizeCommand's audio settings,
  //     ensures Pass B concat demuxer accepts consistent codec across
  //     segments (concat requires identical codec/sample-rate per stream)
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', inputPath,
      '-ss', String(startSec),
      '-to', String(endSec),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-avoid_negative_ts', 'make_zero',
      outputPath,
    ],
  };
}

export function buildNormalizeCommand(
  inputPath: string,
  outputPath: string,
  opts: { width?: number; height?: number; fps?: number } = {},
): FfCommand {
  const { width = 1080, height = 1920, fps = 30 } = opts;
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', inputPath,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
      '-af', 'loudnorm=I=-14:LRA=11:TP=-1',
      '-movflags', '+faststart',
      outputPath,
    ],
  };
}

export function buildAudioExtractCommand(
  inputPath: string,
  outputPath: string,
  opts: { startSec?: number; durationSec?: number } = {},
): FfCommand {
  // When startSec/durationSec are provided, extract only that window of the
  // input. This matches the curator-selected segment timestamps so whisper
  // transcribes the actual segment, not the full normalized clip.
  // -ss BEFORE -i = fast input seek (re-decodes from nearest keyframe, accurate
  // enough for audio at 16kHz). -t after -i caps the duration.
  const { startSec, durationSec } = opts;
  const seekArgs: string[] = [];
  if (typeof startSec === 'number' && startSec > 0) {
    seekArgs.push('-ss', String(startSec));
  }
  const durationArgs: string[] = [];
  if (typeof durationSec === 'number' && durationSec > 0) {
    durationArgs.push('-t', String(durationSec));
  }
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      ...seekArgs,
      '-i', inputPath,
      ...durationArgs,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      outputPath,
    ],
  };
}

export function buildAudioMixCommand(
  videoPath: string,
  musicPath: string,
  outputPath: string,
  musicVolume: number = 0.30,
  opts: { ducking?: boolean } = {},
): FfCommand {
  const { ducking = true } = opts;

  // Dynamic audio ducking: music dips under speech, rises in silent gaps.
  // Sidechain compressor uses UGC audio as the key signal.
  // Attack 50ms (fast duck), release 300ms (natural return).
  const filterComplex = ducking
    ? [
        `[1:a]volume=${musicVolume}[music]`,
        `[0:a]agate=threshold=0.01:attack=5:release=50[gate]`,
        `[music][gate]sidechaincompress=threshold=0.02:ratio=6:attack=50:release=300[ducked]`,
        `[0:a][ducked]amix=inputs=2:duration=first[out]`,
      ].join(';')
    : `[0:a]volume=1.0[ugc];[1:a]volume=${musicVolume}[music];[ugc][music]amix=inputs=2:duration=first[out]`;

  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', videoPath,
      '-i', musicPath,
      '-filter_complex', filterComplex,
      '-map', '0:v',
      '-map', '[out]',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ],
  };
}

type Platform = 'tiktok' | 'instagram' | 'youtube';

const PLATFORM_SETTINGS: Record<Platform, { maxBitrate: string; maxSize: string }> = {
  tiktok:    { maxBitrate: '8M',  maxSize: '287M' },
  instagram: { maxBitrate: '3.5M', maxSize: '100M' },
  youtube:   { maxBitrate: '10M', maxSize: '256M' },
};

export function buildExportCommand(
  inputPath: string,
  outputPath: string,
  platform: Platform,
): FfCommand {
  const { maxBitrate } = PLATFORM_SETTINGS[platform];
  return {
    command: 'ffmpeg',
    args: [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-maxrate', maxBitrate, '-bufsize', `${parseInt(maxBitrate) * 2}M`,
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ],
  };
}
