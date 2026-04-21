import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { withLLMRetry } from '../lib/retry-llm.js';
import {
  PASS1_PROMPT,
  PASS2_PROMPT,
  BOUNDARIES_JSON_SCHEMA,
  SEGMENT_V2_JSON_SCHEMA,
  getParentDurationS,
  clampBoundariesToEOF,
  logClampResult,
} from '../lib/gemini-segments-v2.js';
import {
  SegmentV2Schema,
  BoundariesPassSchema,
  type SegmentV2,
  type BoundariesPass,
} from './segment-analyzer-v2-schema.js';

export interface BatchTimings {
  uploadMs: number;
  activePollMs: number;
  pass1Ms: number;
  pass2Ms: number[];
  deleteMs: number;
  totalMs: number;
}

export interface BatchCounters {
  uploads: number;
  deletes: number;
}

export interface AnalyzeParentResult {
  boundaries: BoundariesPass;
  segments: SegmentV2[];
  timings: BatchTimings;
  counters: BatchCounters;
}

export async function analyzeParentEndToEndV2(
  parentLocalPath: string,
  brandContext: string,
): Promise<AnalyzeParentResult> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const t0 = Date.now();
  const counters: BatchCounters = { uploads: 0, deletes: 0 };

  const parentDurationS = await getParentDurationS(parentLocalPath);

  console.log(`[segments-v2-batch] Uploading ${parentLocalPath} (one-time per parent)`);
  const uploadStart = Date.now();
  let current = await ai.files.upload({
    file: parentLocalPath,
    config: { mimeType: 'video/mp4', displayName: `parent-${randomUUID()}` },
  });
  counters.uploads += 1;
  const uploadMs = Date.now() - uploadStart;

  const fileName = current.name;
  if (!fileName) throw new Error('Gemini upload returned no file name');

  const pollStart = Date.now();
  const deadline = pollStart + 120_000;
  while (current.state === 'PROCESSING') {
    if (Date.now() > deadline) {
      throw new Error(`Gemini file ${fileName} still PROCESSING after 120s`);
    }
    console.log('[segments-v2-batch] File still processing, waiting 2s...');
    await new Promise((r) => setTimeout(r, 2000));
    current = await ai.files.get({ name: fileName });
  }
  if (current.state === 'FAILED') {
    throw new Error(`Gemini file ${fileName} FAILED: ${current.error?.message ?? 'unknown'}`);
  }
  if (!current.uri || !current.mimeType) {
    throw new Error(`Gemini file ${fileName} missing uri/mimeType after activation`);
  }
  const activePollMs = Date.now() - pollStart;
  const fileData = { fileUri: current.uri, mimeType: current.mimeType };

  const pass2Ms: number[] = [];
  let boundaries: BoundariesPass = [];
  let segments: SegmentV2[] = [];
  let pass1Ms = 0;
  let deleteMs = 0;

  try {
    const pass1Prompt = PASS1_PROMPT
      .replace('{brandContext}', brandContext)
      .replace(/\{parent_duration_s\}/g, parentDurationS.toFixed(1));
    const pass1Start = Date.now();
    const pass1Response = await withLLMRetry(
      () =>
        ai.models.generateContent({
          model: env.GEMINI_INGESTION_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData,
                  videoMetadata: { fps: 1 },
                } as unknown as Record<string, unknown>,
                { text: pass1Prompt },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: BOUNDARIES_JSON_SCHEMA as Record<string, unknown>,
            temperature: 0.2,
          },
        }),
      { label: 'segments-v2-batch-pass1', maxAttempts: 2 },
    );
    pass1Ms = Date.now() - pass1Start;
    const pass1Text = pass1Response.text ?? '';
    if (!pass1Text) throw new Error('Pass 1 returned empty text');
    const rawBoundaries = BoundariesPassSchema.parse(JSON.parse(pass1Text));
    console.log(`[segments-v2-batch] Pass 1 → ${rawBoundaries.length} segments (${pass1Ms}ms)`);

    const clamp = clampBoundariesToEOF(rawBoundaries, parentDurationS);
    logClampResult('segments-v2-batch', parentDurationS, clamp);
    boundaries = clamp.boundaries;

    for (let i = 0; i < boundaries.length; i++) {
      const b = boundaries[i];
      const duration = b.end_s - b.start_s;
      const pass2Prompt = PASS2_PROMPT
        .replace('{pass1_segment_type}', b.segment_type)
        .replace('{pass1_notes}', b.preliminary_notes)
        .replace('{start_s}', String(b.start_s))
        .replace('{end_s}', String(b.end_s))
        .replace('{duration_s}', duration.toFixed(1))
        .replace('{brandContext}', brandContext);

      const pass2Start = Date.now();
      const response = await withLLMRetry(
        () =>
          ai.models.generateContent({
            model: env.GEMINI_INGESTION_MODEL,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData,
                    videoMetadata: {
                      startOffset: `${b.start_s}s`,
                      endOffset: `${b.end_s}s`,
                      fps: 5,
                    },
                  } as unknown as Record<string, unknown>,
                  { text: pass2Prompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: SEGMENT_V2_JSON_SCHEMA as Record<string, unknown>,
              temperature: 0.3,
            },
          }),
        { label: `segments-v2-batch-pass2[${i}]`, maxAttempts: 2 },
      );
      const segMs = Date.now() - pass2Start;
      pass2Ms.push(segMs);
      const segText = response.text ?? '';
      if (!segText) throw new Error(`Pass 2 segment ${i} returned empty text`);
      const segment = SegmentV2Schema.parse(JSON.parse(segText));
      segments.push(segment);
      console.log(
        `[segments-v2-batch] Pass 2 [${i + 1}/${boundaries.length}] ${b.segment_type} ${b.start_s}-${b.end_s}s → ${segMs}ms`,
      );
    }
  } finally {
    const deleteStart = Date.now();
    try {
      await ai.files.delete({ name: fileName });
      counters.deletes += 1;
      console.log(`[segments-v2-batch] Deleted Gemini file: ${fileName}`);
    } catch (err) {
      console.warn(`[segments-v2-batch] Delete failed for ${fileName}: ${(err as Error).message}`);
    }
    deleteMs = Date.now() - deleteStart;
  }

  const totalMs = Date.now() - t0;
  return {
    boundaries,
    segments,
    timings: { uploadMs, activePollMs, pass1Ms, pass2Ms, deleteMs, totalMs },
    counters,
  };
}
