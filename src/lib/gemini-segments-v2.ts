import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '../config/env.js';
import { withLLMRetry } from './retry-llm.js';
import { downloadToFile } from './r2-storage.js';
import {
  SegmentV2Schema,
  BoundariesPassSchema,
  type SegmentV2,
  type BoundariesPass,
  type BoundariesPassItem,
} from '../agents/segment-analyzer-v2-schema.js';

// ── Prompt templates ──

export const PASS1_PROMPT = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '../agents/prompts/segment-analyzer-v2-pass1.md'),
  'utf-8',
);
export const PASS2_PROMPT = readFileSync(
  resolve(new URL('.', import.meta.url).pathname, '../agents/prompts/segment-analyzer-v2-pass2.md'),
  'utf-8',
);

// ── Derived JSON Schemas for Gemini structured output ──
// openApi3 target emits `nullable: true` instead of union-with-null — Gemini
// parses this form reliably. $refStrategy: 'none' inlines everything so the
// schema is a single self-contained object (no $ref).

export const SEGMENT_V2_JSON_SCHEMA = zodToJsonSchema(SegmentV2Schema, {
  target: 'openApi3',
  $refStrategy: 'none',
});

export const BOUNDARIES_JSON_SCHEMA = zodToJsonSchema(BoundariesPassSchema, {
  target: 'openApi3',
  $refStrategy: 'none',
});

// ── Helpers ──

const TMP_ROOT = env.RENDER_TEMP_DIR;

// EOF confabulation guards (Rule 38): Pass 1 has been observed to emit
// boundaries past actual video end on specific parents (40-80s of fabricated
// segments, structured around domain expectations — rep cycles, L/R symmetry,
// trailing transitions). We defend in depth: the prompt hard-constrains Pass 1
// with the real duration, and the consumer-side clamp drops/truncates any
// residual out-of-bounds boundaries before Pass 2 runs.

const EOF_TOLERANCE_S = 0.5;
const MIN_SEGMENT_AFTER_CLAMP_S = 0.1;

export async function getParentDurationS(localPath: string): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      localPath,
    ]);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => {
      rejectP(new Error(`ffprobe spawn failed for ${localPath}: ${err.message}`));
    });
    p.on('close', (code) => {
      if (code !== 0) {
        rejectP(new Error(`ffprobe exit ${code} for ${localPath}: ${stderr.trim()}`));
        return;
      }
      const n = parseFloat(stdout.trim());
      if (!Number.isFinite(n) || n <= 0) {
        rejectP(new Error(`ffprobe returned invalid duration for ${localPath}: "${stdout.trim()}"`));
        return;
      }
      resolveP(n);
    });
  });
}

export interface ClampResult {
  boundaries: BoundariesPass;
  originalCount: number;
  droppedPastEofCount: number;
  droppedDegenerateCount: number;
  clampedCount: number;
}

export function clampBoundariesToEOF(
  boundaries: BoundariesPass,
  parentDurationS: number,
): ClampResult {
  const originalCount = boundaries.length;
  let clampedCount = 0;
  let droppedPastEofCount = 0;
  let droppedDegenerateCount = 0;
  const out: BoundariesPass = [];

  for (const b of boundaries) {
    if (b.start_s >= parentDurationS) {
      droppedPastEofCount += 1;
      continue;
    }
    let end_s = b.end_s;
    if (end_s > parentDurationS + EOF_TOLERANCE_S) {
      end_s = parentDurationS;
      clampedCount += 1;
    }
    if (end_s <= b.start_s + MIN_SEGMENT_AFTER_CLAMP_S) {
      droppedDegenerateCount += 1;
      continue;
    }
    out.push({ ...b, end_s });
  }

  return {
    boundaries: out,
    originalCount,
    droppedPastEofCount,
    droppedDegenerateCount,
    clampedCount,
  };
}

export function logClampResult(label: string, parentDurationS: number, r: ClampResult): void {
  const changed = r.clampedCount > 0 || r.droppedPastEofCount > 0 || r.droppedDegenerateCount > 0;
  if (!changed) return;
  console.warn(
    `[${label}] Pass 1 EOF clamp: parent duration=${parentDurationS.toFixed(3)}s, ` +
    `original=${r.originalCount}, clamped=${r.clampedCount}, ` +
    `dropped_past_eof=${r.droppedPastEofCount}, dropped_degenerate=${r.droppedDegenerateCount}, ` +
    `final=${r.boundaries.length}`,
  );
}

async function uploadAndAwaitActive(
  ai: GoogleGenAI,
  localPath: string,
  displayName: string,
): Promise<{ uri: string; mimeType: string; name: string }> {
  console.log(`[gemini-segments-v2] Uploading ${localPath} to Gemini Files API...`);
  const uploaded = await ai.files.upload({
    file: localPath,
    config: { mimeType: 'video/mp4', displayName },
  });

  const fileName = uploaded.name;
  if (!fileName) {
    throw new Error('Gemini upload returned no file name');
  }

  let current = uploaded;
  const deadline = Date.now() + 120_000; // 2 minute upper bound
  while (current.state === 'PROCESSING') {
    if (Date.now() > deadline) {
      throw new Error(`Gemini file ${fileName} still PROCESSING after 120s`);
    }
    console.log('[gemini-segments-v2] File still processing, waiting 2s...');
    await new Promise((r) => setTimeout(r, 2000));
    current = await ai.files.get({ name: fileName });
  }

  if (current.state === 'FAILED') {
    throw new Error(`Gemini file ${fileName} processing FAILED: ${current.error?.message ?? 'unknown'}`);
  }

  if (!current.uri || !current.mimeType) {
    throw new Error(`Gemini file ${fileName} missing uri/mimeType after activation`);
  }

  return { uri: current.uri, mimeType: current.mimeType, name: fileName };
}

async function deleteFileQuiet(ai: GoogleGenAI, name: string): Promise<void> {
  try {
    await ai.files.delete({ name });
    console.log(`[gemini-segments-v2] Deleted Gemini file: ${name}`);
  } catch (err) {
    console.warn(`[gemini-segments-v2] Failed to delete Gemini file ${name}: ${(err as Error).message}`);
  }
}

// ── Pass 1: boundary detection on full parent clip @ 1 FPS ──

export async function analyzeSegmentBoundariesV2(
  parentClipR2Key: string,
  brandContext: string,
): Promise<BoundariesPass> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const localPath = `${TMP_ROOT}/segment-v2-pass1-${randomUUID()}.mp4`;

  await downloadToFile(parentClipR2Key, localPath);
  const parentDurationS = await getParentDurationS(localPath);

  let fileName: string | null = null;
  try {
    const uploaded = await uploadAndAwaitActive(ai, localPath, `pass1-${randomUUID()}`);
    fileName = uploaded.name;

    const prompt = PASS1_PROMPT
      .replace('{brandContext}', brandContext)
      .replace(/\{parent_duration_s\}/g, parentDurationS.toFixed(1));

    const response = await withLLMRetry(
      () =>
        ai.models.generateContent({
          model: env.GEMINI_INGESTION_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType },
                  videoMetadata: { fps: 1 },
                } as unknown as Record<string, unknown>,
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: BOUNDARIES_JSON_SCHEMA as Record<string, unknown>,
            temperature: 0.2,
          },
        }),
      { label: 'segment-v2-pass1', maxAttempts: 2 },
    );

    const text = response.text ?? '';
    if (!text) {
      throw new Error('Gemini Pass 1 returned empty text');
    }
    const raw = JSON.parse(text);
    const boundaries = BoundariesPassSchema.parse(raw);
    const clamp = clampBoundariesToEOF(boundaries, parentDurationS);
    logClampResult('gemini-segments-v2', parentDurationS, clamp);
    return clamp.boundaries;
  } finally {
    if (fileName) await deleteFileQuiet(ai, fileName);
    await unlink(localPath).catch(() => {});
  }
}

// ── Pass 2: deep analysis of one segment @ 5 FPS via videoMetadata clip range ──

export async function analyzeSegmentDeepV2(
  parentClipR2Key: string,
  boundaries: BoundariesPassItem,
  brandContext: string,
): Promise<SegmentV2> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const localPath = `${TMP_ROOT}/segment-v2-pass2-${randomUUID()}.mp4`;

  await downloadToFile(parentClipR2Key, localPath);

  let fileName: string | null = null;
  try {
    const uploaded = await uploadAndAwaitActive(ai, localPath, `pass2-${randomUUID()}`);
    fileName = uploaded.name;

    const duration = boundaries.end_s - boundaries.start_s;
    const prompt = PASS2_PROMPT
      .replace('{pass1_segment_type}', boundaries.segment_type)
      .replace('{pass1_notes}', boundaries.preliminary_notes)
      .replace('{start_s}', String(boundaries.start_s))
      .replace('{end_s}', String(boundaries.end_s))
      .replace('{duration_s}', duration.toFixed(1))
      .replace('{brandContext}', brandContext);

    const response = await withLLMRetry(
      () =>
        ai.models.generateContent({
          model: env.GEMINI_INGESTION_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType },
                  videoMetadata: {
                    startOffset: `${boundaries.start_s}s`,
                    endOffset: `${boundaries.end_s}s`,
                    fps: 5,
                  },
                } as unknown as Record<string, unknown>,
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: SEGMENT_V2_JSON_SCHEMA as Record<string, unknown>,
            temperature: 0.3,
          },
        }),
      { label: 'segment-v2-pass2', maxAttempts: 2 },
    );

    const text = response.text ?? '';
    if (!text) {
      throw new Error('Gemini Pass 2 returned empty text');
    }
    const raw = JSON.parse(text);
    return SegmentV2Schema.parse(raw);
  } finally {
    if (fileName) await deleteFileQuiet(ai, fileName);
    await unlink(localPath).catch(() => {});
  }
}
