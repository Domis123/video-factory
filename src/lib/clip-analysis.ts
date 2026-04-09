/**
 * FFmpeg-based clip analysis — extracts visual metadata during ingestion.
 * Feeds downstream phases: color grading (Phase 5), clip sequencing, visual flow.
 */

import { exec } from './exec.js';
import { execOrThrow } from './exec.js';
import type { FfCommand } from './ffmpeg.js';

export interface ClipAnalysis {
  dominant_color_hex: string;
  motion_intensity: 'low' | 'medium' | 'high';
  avg_brightness: number;
  scene_cuts: number;
}

/**
 * Analyze a video clip for color, motion, and brightness.
 * All analysis runs via FFmpeg — no external dependencies.
 */
export async function analyzeClipMetadata(filePath: string): Promise<ClipAnalysis> {
  const [dominantColor, motionData, brightness] = await Promise.all([
    extractDominantColor(filePath),
    detectMotionIntensity(filePath),
    extractAvgBrightness(filePath),
  ]);

  return {
    dominant_color_hex: dominantColor,
    motion_intensity: motionData.intensity,
    avg_brightness: brightness,
    scene_cuts: motionData.sceneCuts,
  };
}

/**
 * Extract dominant color by sampling frames and averaging.
 * Uses FFmpeg to scale frames to 8x8 and reads pixel data from signalstats.
 */
async function extractDominantColor(filePath: string): Promise<string> {
  try {
    // Use signalstats to get average R, G, B across sampled frames
    const cmd: FfCommand = {
      command: 'ffmpeg',
      args: [
        '-i', filePath,
        '-vf', 'fps=1,scale=8:8,signalstats,metadata=mode=print',
        '-frames:v', '5',
        '-f', 'null',
        '-',
      ],
    };

    const result = await exec(cmd);
    const output = result.stderr; // FFmpeg metadata goes to stderr

    // Extract HUEAVG (hue), SATAVG (saturation), YAVG (luma) as proxy for color
    // Alternatively, parse UAVG/VAVG for chroma
    const yMatches = output.match(/lavfi\.signalstats\.YAVG=(\d+\.?\d*)/g);
    const uMatches = output.match(/lavfi\.signalstats\.UAVG=(\d+\.?\d*)/g);
    const vMatches = output.match(/lavfi\.signalstats\.VAVG=(\d+\.?\d*)/g);

    if (!yMatches || !uMatches || !vMatches) return '#808080';

    const avgY = average(yMatches.map(m => parseFloat(m.split('=')[1])));
    const avgU = average(uMatches.map(m => parseFloat(m.split('=')[1])));
    const avgV = average(vMatches.map(m => parseFloat(m.split('=')[1])));

    // YUV to RGB conversion (BT.601)
    const r = clamp(Math.round(avgY + 1.402 * (avgV - 128)));
    const g = clamp(Math.round(avgY - 0.344136 * (avgU - 128) - 0.714136 * (avgV - 128)));
    const b = clamp(Math.round(avgY + 1.772 * (avgU - 128)));

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch {
    console.warn('[clip-analysis] Dominant color extraction failed, using fallback');
    return '#808080';
  }
}

/**
 * Detect motion intensity via scene change detection.
 * Counts scene cuts and divides by duration → low / medium / high.
 */
async function detectMotionIntensity(filePath: string): Promise<{ intensity: 'low' | 'medium' | 'high'; sceneCuts: number }> {
  try {
    const cmd: FfCommand = {
      command: 'ffmpeg',
      args: [
        '-i', filePath,
        '-vf', "select='gt(scene,0.3)',metadata=mode=print",
        '-f', 'null',
        '-',
      ],
    };

    const result = await exec(cmd);
    const output = result.stderr;
    const sceneLines = output.split('\n').filter(line => line.includes('lavfi.scene_score'));
    const sceneCuts = sceneLines.length;

    // Get duration
    const durationStr = await execOrThrow({
      command: 'ffprobe',
      args: ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
    });
    const duration = parseFloat(durationStr.trim()) || 1;

    const cutsPerSecond = sceneCuts / duration;

    let intensity: 'low' | 'medium' | 'high';
    if (cutsPerSecond < 0.5) intensity = 'low';
    else if (cutsPerSecond > 1.5) intensity = 'high';
    else intensity = 'medium';

    return { intensity, sceneCuts };
  } catch {
    console.warn('[clip-analysis] Motion detection failed, using fallback');
    return { intensity: 'medium', sceneCuts: 0 };
  }
}

/**
 * Extract average brightness using signalstats YAVG.
 * Returns 0-255 value representing average luminance.
 */
async function extractAvgBrightness(filePath: string): Promise<number> {
  try {
    const cmd: FfCommand = {
      command: 'ffmpeg',
      args: [
        '-i', filePath,
        '-vf', 'signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG',
        '-frames:v', '10',
        '-f', 'null',
        '-',
      ],
    };

    const result = await exec(cmd);
    const output = result.stderr;
    const yavgMatches = output.match(/lavfi\.signalstats\.YAVG=(\d+\.?\d*)/g);

    if (!yavgMatches || yavgMatches.length === 0) return 128;

    const values = yavgMatches.map(m => parseFloat(m.split('=')[1]));
    return Math.round(average(values));
  } catch {
    console.warn('[clip-analysis] Brightness extraction failed, using fallback');
    return 128;
  }
}

function average(nums: number[]): number {
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}
