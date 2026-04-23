/**
 * W5 R2 fetch helper — `fetchKeyframeGrid(r2Key): Promise<Buffer>`.
 *
 * Reuses the existing R2 client init (`src/config/r2.ts`) via the shared
 * `downloadFile(r2Key)` stream helper in `r2-storage.ts`. We do NOT introduce
 * a new @aws-sdk client here per the W5 brief's naming-conflict guard.
 *
 * The Visual Director needs keyframe grids as Buffers for Gemini `inlineData`.
 * `downloadFile` returns a Readable — this function concatenates it into a
 * Buffer. Thin wrapper; kept as a lib-level helper for later reuse.
 *
 * File: src/lib/r2-fetch.ts
 */

import { downloadFile } from './r2-storage.js';

export async function fetchKeyframeGrid(r2Key: string): Promise<Buffer> {
  if (!r2Key || !r2Key.trim()) {
    throw new Error('fetchKeyframeGrid: r2Key is required');
  }
  const stream = await downloadFile(r2Key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
