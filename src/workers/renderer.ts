import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { join } from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { env } from '../config/env.js';
import { downloadToFile, uploadFile } from '../lib/r2-storage.js';
import type { ContextPacket, ClipSelection } from '../types/database.js';
import type { TemplateProps } from '../templates/types.js';
import type { WordTimestamp } from '../templates/components/CaptionTrack.js';

const REMOTION_ENTRY = join(import.meta.dirname ?? '.', '..', 'templates', 'Root.tsx');

export interface RenderInput {
  jobId: string;
  contextPacket: ContextPacket;
  /** Word-level transcriptions per segment_id (from whisper) */
  transcriptions: Record<number, WordTimestamp[]>;
}

export interface RenderOutput {
  outputPath: string;
  r2Key: string;
  durationMs: number;
}

/**
 * Render a video from a Context Packet using Remotion.
 *
 * 1. Download all selected clips from R2 to temp dir
 * 2. Download logo + music if present
 * 3. Bundle the Remotion project
 * 4. Render the composition matching the template_id
 * 5. Upload rendered video to R2
 */
export async function renderVideo(input: RenderInput): Promise<RenderOutput> {
  const { jobId, contextPacket, transcriptions } = input;
  const { brief, clips, brand_config: brand } = contextPacket;
  const templateId = brief.template_id;

  const workDir = join(env.RENDER_TEMP_DIR, jobId);
  const clipsDir = join(workDir, 'clips');
  const outputPath = join(workDir, `output-${templateId}.mp4`);

  console.log(`[renderer] Job ${jobId}: starting render (${templateId})`);
  const startTime = Date.now();

  try {
    // 1. Create working directories
    await mkdir(clipsDir, { recursive: true });

    // 2. Download clips from R2
    console.log(`[renderer] Downloading ${clips.clip_selections.length} segment clips...`);
    const clipPaths = await downloadClips(clips.clip_selections, clipsDir);

    // 3. Download logo if configured
    let logoPath: string | null = null;
    if (brand.logo_r2_key) {
      logoPath = join(workDir, 'logo.png');
      try {
        await downloadToFile(brand.logo_r2_key, logoPath);
      } catch {
        console.warn(`[renderer] Logo not found at ${brand.logo_r2_key}, skipping`);
        logoPath = null;
      }
    }

    // 4. Download background music if selected
    let musicPath: string | null = null;
    if (contextPacket.music_selection?.r2_key) {
      musicPath = join(workDir, 'music.mp3');
      try {
        await downloadToFile(contextPacket.music_selection.r2_key, musicPath);
      } catch {
        console.warn(`[renderer] Music not found at ${contextPacket.music_selection.r2_key}, skipping`);
        musicPath = null;
      }
    }

    // 5. Bundle Remotion project
    console.log(`[renderer] Bundling Remotion project...`);
    const bundleLocation = await bundle({
      entryPoint: REMOTION_ENTRY,
      onProgress: (progress) => {
        if (progress % 25 === 0) console.log(`[renderer] Bundle: ${progress}%`);
      },
    });

    // 6. Build input props
    const inputProps: TemplateProps = {
      contextPacket,
      clipPaths,
      transcriptions,
      logoPath,
      musicPath,
    };

    // 7. Select composition (sets duration from Context Packet)
    const totalDurationFrames = Math.round(brief.total_duration_target * 30); // 30fps
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: templateId,
      inputProps: inputProps as unknown as Record<string, unknown>,
    });

    // Override duration from Context Packet
    composition.durationInFrames = totalDurationFrames;

    // 8. Render
    console.log(`[renderer] Rendering ${templateId} — ${brief.total_duration_target}s @ 30fps (${totalDurationFrames} frames)...`);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: inputProps as unknown as Record<string, unknown>,
      onProgress: ({ renderedFrames, encodedFrames }) => {
        if (renderedFrames % 150 === 0) {
          console.log(`[renderer] Rendered: ${renderedFrames}/${totalDurationFrames} frames, Encoded: ${encodedFrames}`);
        }
      },
    });

    const durationMs = Date.now() - startTime;
    console.log(`[renderer] Render complete in ${(durationMs / 1000).toFixed(1)}s: ${outputPath}`);

    // 9. Upload to R2
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const r2Key = `rendered/${brand.brand_id}/${month}/${jobId}-${templateId}.mp4`;

    console.log(`[renderer] Uploading to R2: ${r2Key}`);
    const videoBuffer = await readFile(outputPath);
    await uploadFile(r2Key, videoBuffer, 'video/mp4');

    return { outputPath, r2Key, durationMs };
  } finally {
    // Cleanup temp files (keep output for downstream workers)
    if (existsSync(clipsDir)) {
      await rm(clipsDir, { recursive: true, force: true });
    }
  }
}

/**
 * Download all clips from R2 and return a map of segment_id → local path(s).
 */
async function downloadClips(
  selections: ClipSelection[],
  clipsDir: string,
): Promise<Record<number, string | string[]>> {
  const result: Record<number, string | string[]> = {};

  for (const sel of selections) {
    if (sel.clips && sel.clips.length > 0) {
      // Multi-clip segment
      const paths: string[] = [];
      for (let i = 0; i < sel.clips.length; i++) {
        const clip = sel.clips[i];
        const localPath = join(clipsDir, `seg${sel.segment_id}-clip${i}.mp4`);
        await downloadToFile(clip.r2_key, localPath);
        paths.push(localPath);
      }
      result[sel.segment_id] = paths;
    } else if (sel.r2_key) {
      // Single clip segment
      const localPath = join(clipsDir, `seg${sel.segment_id}.mp4`);
      await downloadToFile(sel.r2_key, localPath);
      result[sel.segment_id] = localPath;
    }
  }

  return result;
}
