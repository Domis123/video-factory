import { execOrThrow } from './exec.js';

export class KeyframeExtractionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'KeyframeExtractionError';
    this.cause = cause;
  }
}

/**
 * Extract a single keyframe from a video at the given timestamp.
 * Uses ffmpeg -vframes 1 at high-quality JPEG (-q:v 2).
 */
export async function extractKeyframe(
  videoPath: string,
  timestampSeconds: number,
  outPath: string,
): Promise<void> {
  try {
    await execOrThrow({
      command: 'ffmpeg',
      args: [
        '-y',
        '-ss', String(timestampSeconds),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        outPath,
      ],
    });
  } catch (err) {
    throw new KeyframeExtractionError(
      `Failed to extract keyframe at ${timestampSeconds}s from ${videoPath}`,
      err,
    );
  }
}
