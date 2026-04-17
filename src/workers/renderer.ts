import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { join } from 'node:path';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { env } from '../config/env.js';
import { downloadToFile, uploadFile } from '../lib/r2-storage.js';
import type { ContextPacket, Phase3ContextPacket, ClipSelection, Phase3CreativeBrief } from '../types/database.js';
import type { TemplateProps, Phase3TemplateProps } from '../templates/types.js';
import { resolvePhase3Segments, totalPhase3Frames } from '../templates/resolve-phase3.js';
import type { WordTimestamp } from '../templates/components/CaptionTrack.js';

const REMOTION_ENTRY = join(import.meta.dirname ?? '.', '..', 'templates', 'Root.tsx');

export interface RenderInput {
  jobId: string;
  contextPacket: ContextPacket | Phase3ContextPacket;
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
  const { clips, brand_config: brand } = contextPacket;
  const isPhase3 = 'creative_direction' in contextPacket.brief;
  const compositionId = isPhase3
    ? (contextPacket.brief as Phase3CreativeBrief).composition_id
    : (contextPacket as ContextPacket).brief.template_id;

  const workDir = join(env.RENDER_TEMP_DIR, jobId);
  const publicDir = join(workDir, 'public');
  const outputPath = join(workDir, `output-${compositionId}.mp4`);

  console.log(`[renderer] Job ${jobId}: starting render (${compositionId}${isPhase3 ? ', Phase 3' : ''})`);
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

    // 6. Build input props (Phase 2 vs Phase 3)
    let inputProps: Record<string, unknown>;
    let totalDurationFrames: number;

    if (isPhase3) {
      const p3 = contextPacket as Phase3ContextPacket;
      const p3Props: Phase3TemplateProps = {
        brief: p3.brief,
        copyPackage: p3.copy,
        clipPaths,
        transcriptions,
        logoPath,
        musicPath,
        brandConfig: brand,
        beatMap: p3.music_selection?.beat_map ?? null,
      };
      inputProps = p3Props as unknown as Record<string, unknown>;
      const resolved = resolvePhase3Segments(p3.brief, p3.copy, clipPaths, 30);
      totalDurationFrames = totalPhase3Frames(resolved);
    } else {
      const p2 = contextPacket as ContextPacket;
      const p2Props: TemplateProps = {
        contextPacket: p2,
        clipPaths,
        transcriptions,
        logoPath,
        musicPath,
        beatMap: p2.music_selection?.beat_map ?? null,
      };
      inputProps = p2Props as unknown as Record<string, unknown>;
      totalDurationFrames = Math.round(p2.brief.total_duration_target * 30);
    }

    // 7. Select composition
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps,
    });
    composition.durationInFrames = totalDurationFrames;

    // 8. Render
    console.log(`[renderer] Rendering ${compositionId} — ${totalDurationFrames} frames @ 30fps...`);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
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
    const r2Key = `rendered/${brand.brand_id}/${month}/${jobId}-${compositionId}.mp4`;

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
