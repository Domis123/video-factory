import { execOrThrow } from './exec.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { uploadFile } from './r2-storage.js';
import { supabaseAdmin } from '../config/supabase.js';

const CELL_W = 256;
const CELL_H = 455;
const COLS = 4;
const ROWS = 3;
const TILE_COUNT = COLS * ROWS; // 12
const GRID_W = CELL_W * COLS; // 1024
const GRID_H = CELL_H * ROWS; // 1365

const GENERATOR_VERSION = 'w1.1';

export class KeyframeGridError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'KeyframeGridError';
    this.cause = cause;
  }
}

export interface KeyframeGridParams {
  parentLocalPath: string;
  windowStartS: number;
  windowEndS: number;
  segmentId: string;
  startS: number;
  endS: number;
}

export interface KeyframeGridResult {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  warnings: string[];
  windowUsed: { startS: number; endS: number; fellBackToSegmentBounds: boolean };
  missingTileIndices: number[];
}

/**
 * Build a 4×3 portrait mosaic (1024×1365) from 12 frames evenly sampled across the
 * editorial window. Ordering is chronological row-major (index 0 = top-left earliest,
 * index 11 = bottom-right latest) — an explicit invariant, not an emergent property
 * of the filter graph. EXIF metadata embeds segment coordinates for downstream
 * cross-reference without OCR.
 *
 * Failure modes are degraded rather than fatal: missing tiles become black pads,
 * sub-1s windows fall back to segment bounds, degenerate same-timestamp windows
 * still produce output (duplicate frames accepted). Callers get warnings[] for
 * logging/checkpoint capture.
 *
 * Caller owns the parent video file — this function reads but never downloads or
 * deletes it.
 */
export async function buildKeyframeGrid(
  params: KeyframeGridParams,
): Promise<KeyframeGridResult> {
  const { parentLocalPath, segmentId, startS, endS } = params;
  let { windowStartS, windowEndS } = params;
  const warnings: string[] = [];
  let fellBackToSegmentBounds = false;

  // Window validation — fall back to segment bounds if best-point window is sub-1s
  if (windowEndS - windowStartS < 1.0) {
    warnings.push(
      `window <1s (${(windowEndS - windowStartS).toFixed(3)}s), falling back to segment bounds [${startS}, ${endS}]`,
    );
    windowStartS = startS;
    windowEndS = endS;
    fellBackToSegmentBounds = true;
  }
  if (windowEndS - windowStartS < 1.0) {
    warnings.push(
      `segment bounds also <1s (${(windowEndS - windowStartS).toFixed(3)}s), frames may duplicate`,
    );
  }

  // 12 chronological timestamps, inclusive endpoints
  const span = windowEndS - windowStartS;
  const timestamps: number[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const ts = span <= 0 ? windowStartS : windowStartS + (i * span) / (TILE_COUNT - 1);
    timestamps.push(Math.max(0, ts));
  }

  const tmp = await mkdtemp(join(tmpdir(), `kfgrid-${segmentId}-`));
  const missingTileIndices: number[] = [];
  const tiles: (Buffer | null)[] = new Array(TILE_COUNT).fill(null);

  try {
    for (let i = 0; i < TILE_COUNT; i++) {
      const tilePath = join(tmp, `tile_${String(i).padStart(2, '0')}.jpg`);
      try {
        // scale+crop rather than scale+pad:
        //   - force_original_aspect_ratio=decrease combined with even-dimension rounding
        //     can produce a tile 1px larger than the target, which pad rejects
        //     ("Padded dimensions cannot be smaller than input dimensions").
        //   - increase+crop fills the cell edge-to-edge and center-crops any overflow.
        //     For near-9:16 pre-normalized parents the crop is 0-1px; for off-aspect
        //     fallback raw parents the crop beats black letterbox bars inside the cell.
        await execOrThrow({
          command: 'ffmpeg',
          args: [
            '-y',
            '-ss',
            timestamps[i].toFixed(3),
            '-i',
            parentLocalPath,
            '-frames:v',
            '1',
            '-vf',
            `scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=increase,crop=${CELL_W}:${CELL_H}`,
            '-q:v',
            '3',
            tilePath,
          ],
        });
        tiles[i] = await readFile(tilePath);
      } catch (err) {
        missingTileIndices.push(i);
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`tile[${i}] ts=${timestamps[i].toFixed(3)}s extraction failed: ${msg}`);
      }
    }

    if (missingTileIndices.length === TILE_COUNT) {
      throw new KeyframeGridError(
        `all 12 tile extractions failed for segment ${segmentId}; likely parent-level ffmpeg problem`,
      );
    }

    const composites = tiles
      .map((tileBuf, i) => {
        if (!tileBuf) return null;
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return {
          input: tileBuf,
          top: row * CELL_H,
          left: col * CELL_W,
        };
      })
      .filter((c): c is { input: Buffer; top: number; left: number } => c !== null);

    const exifPayload = JSON.stringify({
      segment_id: segmentId,
      start_s: startS,
      end_s: endS,
      best_in_point_s: params.windowStartS,
      best_out_point_s: params.windowEndS,
      generated_at: new Date().toISOString(),
      generator_version: GENERATOR_VERSION,
    });

    const jpeg = await sharp({
      create: {
        width: GRID_W,
        height: GRID_H,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 80 })
      // ImageDescription (IFD0) intentionally used instead of UserComment (IFD2): EXIF 2.3
      // requires UserComment to carry an 8-byte character-code prefix (ASCII\0\0\0 etc.)
      // which sharp 0.33 does not prepend — readers would see garbled leading bytes.
      .withExif({
        IFD0: {
          ImageDescription: exifPayload,
        },
      })
      .toBuffer();

    return {
      buffer: jpeg,
      widthPx: GRID_W,
      heightPx: GRID_H,
      warnings,
      windowUsed: { startS: windowStartS, endS: windowEndS, fellBackToSegmentBounds },
      missingTileIndices,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract the JSON payload written into the EXIF ImageDescription field.
 * Used by the Gate A smoke runner to prove the EXIF round-trip works; also
 * usable by W5 consumers to cross-reference a grid back to its segment.
 */
export async function readKeyframeGridExif(
  jpegBuffer: Buffer,
): Promise<Record<string, unknown> | null> {
  const { exif } = await sharp(jpegBuffer).metadata();
  if (!exif) return null;

  // The EXIF buffer is TIFF-formatted. ImageDescription is stored as an ASCII
  // string. Rather than pull in a TIFF parser, locate our payload by searching
  // for its opening brace — the JSON is unambiguous in a binary EXIF block.
  const ascii = exif.toString('binary');
  const start = ascii.indexOf('{"segment_id"');
  if (start < 0) return null;
  // JSON payload is null-terminated in ASCII EXIF strings
  const nulIdx = ascii.indexOf('\0', start);
  const end = nulIdx < 0 ? ascii.length : nulIdx;
  const json = ascii.slice(start, end);
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface GridRow {
  id: string;
  brand_id: string;
  start_s: number;
  end_s: number;
  best_in_point_s: number | null;
  best_out_point_s: number | null;
}

export interface GridOutcome {
  r2Key: string;
  sizeBytes: number;
  warnings: string[];
  missingTileIndices: number[];
  fellBackToSegmentBounds: boolean;
}

/**
 * Build a grid for a single segment, upload to R2, and write keyframe_grid_r2_key
 * on the segment row. Shared between the backfill script and the ingestion worker
 * so they stay in lockstep. Caller provides a local parent video path; this function
 * does not download or delete it.
 *
 * Throws on DB update failure or total-extraction failure. Per-tile failures are
 * swallowed into warnings per buildKeyframeGrid() contract.
 */
export async function generateAndStoreGrid(
  parentLocalPath: string,
  row: GridRow,
): Promise<GridOutcome> {
  const bestIn = row.best_in_point_s ?? row.start_s;
  const bestOut = row.best_out_point_s ?? row.end_s;

  const result = await buildKeyframeGrid({
    parentLocalPath,
    windowStartS: bestIn,
    windowEndS: bestOut,
    segmentId: row.id,
    startS: row.start_s,
    endS: row.end_s,
  });

  const r2Key = `keyframe-grids/${row.brand_id}/${row.id}.jpg`;
  await uploadFile(r2Key, result.buffer, 'image/jpeg');

  const { error } = await supabaseAdmin
    .from('asset_segments')
    .update({ keyframe_grid_r2_key: r2Key })
    .eq('id', row.id);
  if (error) {
    throw new KeyframeGridError(
      `failed to update keyframe_grid_r2_key on segment ${row.id}: ${error.message}`,
    );
  }

  return {
    r2Key,
    sizeBytes: result.buffer.length,
    warnings: result.warnings,
    missingTileIndices: result.missingTileIndices,
    fellBackToSegmentBounds: result.windowUsed.fellBackToSegmentBounds,
  };
}

export const KEYFRAME_GRID_GEOMETRY = Object.freeze({
  cols: COLS,
  rows: ROWS,
  cellW: CELL_W,
  cellH: CELL_H,
  gridW: GRID_W,
  gridH: GRID_H,
  tileCount: TILE_COUNT,
  generatorVersion: GENERATOR_VERSION,
});
