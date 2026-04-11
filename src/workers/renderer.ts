import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { join } from 'node:path';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
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
  // Remotion's bundler serves a `publicDir` over HTTP at runtime, and the
  // template uses `staticFile(name)` to fetch files from it. We collect every
  // asset (clips, logo, music) into a single flat directory under the job's
  // workDir and hand bare filenames to the template.
  const publicDir = join(workDir, 'public');
  const outputPath = join(workDir, `output-${templateId}.mp4`);

  console.log(`[renderer] Job ${jobId}: starting render (${templateId})`);
  const startTime = Date.now();

  try {
    // 1. Create publicDir
    await mkdir(publicDir, { recursive: true });

    // 2. Download clips from R2 directly into publicDir with flat filenames
    console.log(`[renderer] Downloading ${clips.clip_selections.length} segment clips...`);
    const clipPaths = await downloadClips(clips.clip_selections, publicDir);

    // 3. Download logo if configured (into publicDir as logo.png)
    let logoPath: string | null = null;
    if (brand.logo_r2_key) {
      const logoFilename = 'logo.png';
      const logoAbs = join(publicDir, logoFilename);
      try {
        await downloadToFile(brand.logo_r2_key, logoAbs);
        // Verify the file actually landed on disk and isn't empty — Day 4
        // shipped a video with no visible logo and we need to know whether
        // the failure is at the download step or in the template.
        const s = await stat(logoAbs);
        if (s.size === 0) {
          console.warn(`[renderer] Logo downloaded to ${logoAbs} but is 0 bytes — skipping`);
          logoPath = null;
        } else {
          console.log(`[renderer] Logo ready at ${logoAbs} (${s.size} bytes)`);
          logoPath = logoFilename;
        }
      } catch (err) {
        console.warn(`[renderer] Logo not found at ${brand.logo_r2_key} (${String(err)}), skipping`);
        logoPath = null;
      }
    } else {
      console.log(`[renderer] Brand ${brand.brand_id} has no logo_r2_key, skipping watermark`);
    }

    // 4. Download background music if selected (into publicDir as music.mp3)
    let musicPath: string | null = null;
    if (contextPacket.music_selection?.r2_key) {
      const musicFilename = 'music.mp3';
      const musicAbs = join(publicDir, musicFilename);
      try {
        await downloadToFile(contextPacket.music_selection.r2_key, musicAbs);
        musicPath = musicFilename;
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
    console.log(`[renderer] Bundling Remotion project (publicDir: ${publicDir})...`);
    const bundleLocation = await bundle({
      entryPoint: REMOTION_ENTRY,
      publicDir,
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
    // clipPaths/logoPath/musicPath are bare filenames relative to publicDir.
    // Template components wrap them with `staticFile()`, which resolves to
    // the URL Remotion's bundle server actually serves.
    const inputProps: TemplateProps = {
      contextPacket,
      clipPaths,
      transcriptions,
      logoPath,
      musicPath,
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
    // Cleanup publicDir (keep output mp4 alongside it for downstream workers)
    if (existsSync(publicDir)) {
      await rm(publicDir, { recursive: true, force: true });
    }
  }
}

/**
 * Download all clips from R2 directly into the bundle's publicDir using flat
 * filenames, and return a map of segment_id → bare filename(s) (no directory
 * component). The template wraps each filename with `staticFile()`, which
 * resolves it through Remotion's bundle server.
 */
async function downloadClips(
  selections: ClipSelection[],
  publicDir: string,
): Promise<Record<number, string | string[]>> {
  const result: Record<number, string | string[]> = {};

  for (const sel of selections) {
    if (sel.clips && sel.clips.length > 0) {
      // Multi-clip segment
      const filenames: string[] = [];
      for (let i = 0; i < sel.clips.length; i++) {
        const clip = sel.clips[i];
        const filename = `seg${sel.segment_id}-clip${i}.mp4`;
        await downloadToFile(clip.r2_key, join(publicDir, filename));
        filenames.push(filename);
      }
      result[sel.segment_id] = filenames;
    } else if (sel.r2_key) {
      // Single clip segment
      const filename = `seg${sel.segment_id}.mp4`;
      await downloadToFile(sel.r2_key, join(publicDir, filename));
      result[sel.segment_id] = filename;
    }
  }

  return result;
}
