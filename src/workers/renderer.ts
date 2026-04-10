import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
    // The project ships as TypeScript sources with NodeNext module resolution,
    // which requires `.js` extensions on relative imports (e.g.
    // `./HookDemoCTA.js`) even though the files on disk are `.tsx`. Remotion's
    // default webpack config resolves `.tsx` but doesn't know to try `.tsx`
    // when asked for `.js`, so the bundle fails with `Can't resolve
    // './layouts/HookDemoCTA.js'`. The webpack 5 `resolve.extensionAlias`
    // field is the standard fix: when webpack sees a `.js` relative import,
    // it also tries the matching `.ts`/`.tsx` file first.
    console.log(`[renderer] Bundling Remotion project...`);
    const bundleLocation = await bundle({
      entryPoint: REMOTION_ENTRY,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...(config.resolve ?? {}),
          extensionAlias: {
            ...((config.resolve as { extensionAlias?: Record<string, string[]> })?.extensionAlias ?? {}),
            '.js': ['.tsx', '.ts', '.js'],
            '.mjs': ['.mts', '.mjs'],
          },
        },
      }),
      onProgress: (progress) => {
        if (progress % 25 === 0) console.log(`[renderer] Bundle: ${progress}%`);
      },
    });

    // 6. Build input props
    // Remotion renders inside a Chromium instance served from a webpack bundle
    // directory, so bare absolute filesystem paths like
    // `/tmp/video-factory/.../clips/seg1-clip0.mp4` get resolved against the
    // bundle's document root and 404. Convert every local file path we pass
    // into the template to a `file://` URL so Chromium loads it straight from
    // disk.
    const clipPathsAsUrls = toFileUrlClipPaths(clipPaths);
    const logoPathUrl = logoPath ? pathToFileURL(logoPath).href : null;
    const musicPathUrl = musicPath ? pathToFileURL(musicPath).href : null;

    const inputProps: TemplateProps = {
      contextPacket,
      clipPaths: clipPathsAsUrls,
      transcriptions,
      logoPath: logoPathUrl,
      musicPath: musicPathUrl,
      beatMap: contextPacket.music_selection?.beat_map ?? null,
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
 * Convert every clip path in a `clipPaths` map to a `file://` URL. Accepts
 * both the single-clip (`string`) and multi-clip (`string[]`) shapes.
 * Called once on the whole map before props reach Remotion so template
 * components receive something Chromium can load directly.
 */
function toFileUrlClipPaths(
  paths: Record<number, string | string[]>,
): Record<number, string | string[]> {
  const out: Record<number, string | string[]> = {};
  for (const [segmentId, value] of Object.entries(paths)) {
    const id = Number(segmentId);
    if (Array.isArray(value)) {
      out[id] = value.map((p) => pathToFileURL(p).href);
    } else {
      out[id] = pathToFileURL(value).href;
    }
  }
  return out;
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
