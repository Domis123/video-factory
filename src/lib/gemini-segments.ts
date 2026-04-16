import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { withLLMRetry } from './retry-llm.js';

// ── Segment analysis types ──

export const SEGMENT_TYPES = [
  'setup', 'exercise', 'transition', 'hold', 'cooldown',
  'talking-head', 'b-roll', 'unusable',
] as const;

export type SegmentType = typeof SEGMENT_TYPES[number];

export interface SegmentAnalysis {
  start_s: number;
  end_s: number;
  segment_type: SegmentType;
  description: string;
  visual_tags: string[];
  best_used_as: string[];
  motion_intensity: number;
  recommended_duration_s: number;
  has_speech: boolean;
  quality_score: number;
}

// ── Zod schema for validation ──

const VALID_BEST_USED_AS = [
  'b-roll', 'demo', 'hook', 'transition', 'establishing', 'talking-head',
] as const;

const segmentSchema = z.object({
  start_s: z.number().min(0),
  end_s: z.number().positive(),
  segment_type: z.enum(SEGMENT_TYPES),
  description: z.string().min(1),
  visual_tags: z.array(z.string()).min(1),
  best_used_as: z.array(z.enum(VALID_BEST_USED_AS)),
  motion_intensity: z.number().int().min(1).max(10),
  recommended_duration_s: z.number().min(0),
  has_speech: z.boolean(),
  quality_score: z.number().int().min(1).max(10),
});

// ── Prompt ──

const PROMPT_PATH = resolve(
  new URL('.', import.meta.url).pathname,
  '../agents/prompts/segment-analyzer.md',
);
const PROMPT_TEMPLATE = readFileSync(PROMPT_PATH, 'utf-8');

// ── MIME map ──

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

// ── Model config ──

const MODEL_ID = process.env['GEMINI_INGESTION_MODEL'] ?? 'gemini-2.5-pro';

// ── Main function ──

/**
 * Analyze a video clip into 3–10 segments per minute using Gemini Pro.
 * Uses the Files API for upload (no base64 size limits).
 * Returns validated segments sorted by start_s.
 */
export async function analyzeClipSegments(
  videoPath: string,
  durationSeconds: number,
  brandContext: string,
): Promise<SegmentAnalysis[]> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const fileManager = new GoogleAIFileManager(env.GEMINI_API_KEY);

  const ext = extname(videoPath).toLowerCase();
  const mimeType = MIME_MAP[ext] ?? 'video/mp4';

  // 1. Upload video via Files API
  console.log(`[gemini-segments] Uploading ${videoPath} to Gemini Files API...`);
  const uploadResult = await fileManager.uploadFile(videoPath, {
    mimeType,
    displayName: `segment-analysis-${Date.now()}`,
  });

  let file = uploadResult.file;
  const fileName = file.name;

  try {
    // 2. Poll until ACTIVE
    while (file.state === FileState.PROCESSING) {
      console.log('[gemini-segments] File still processing, waiting 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      file = await fileManager.getFile(fileName);
    }

    if (file.state === FileState.FAILED) {
      throw new Error(`Gemini file processing failed for ${fileName}: ${file.error?.message ?? 'unknown error'}`);
    }

    // 3. Generate segment analysis
    const prompt = PROMPT_TEMPLATE.replace('{brandContext}', brandContext);

    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      } as Record<string, unknown>,
    });

    console.log(`[gemini-segments] Sending to ${MODEL_ID} for analysis...`);
    const result = await withLLMRetry(
      () => model.generateContent([
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri,
          },
        },
        { text: prompt },
      ]),
      { label: 'ingestion-segments' },
    );

    const text = result.response.text();

    // 4. Parse JSON array
    let rawSegments: unknown[];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not a JSON array');
      }
      rawSegments = parsed;
    } catch (parseErr) {
      // Try to extract array from response if wrapped in markdown
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        throw new Error(`Failed to parse Gemini response as JSON array: ${(parseErr as Error).message}`);
      }
      rawSegments = JSON.parse(match[0]);
    }

    // 5. Validate each segment with Zod, drop invalid ones
    const validSegments: SegmentAnalysis[] = [];
    for (let i = 0; i < rawSegments.length; i++) {
      const parsed = segmentSchema.safeParse(rawSegments[i]);
      if (parsed.success) {
        const seg = { ...parsed.data };
        // Clamp end_s to source duration
        if (seg.end_s > durationSeconds) {
          seg.end_s = durationSeconds;
        }
        // Skip degenerate segments after clamping
        if (seg.end_s <= seg.start_s) {
          console.warn(`[gemini-segments] Dropping segment ${i}: end_s <= start_s after clamping`);
          continue;
        }
        // Business rules for 'unusable' segments — coerce rather than drop
        if (seg.segment_type === 'unusable') {
          if (seg.recommended_duration_s !== 0) {
            console.warn(`[gemini-segments] Coercing unusable segment ${i} recommended_duration_s ${seg.recommended_duration_s} → 0`);
            seg.recommended_duration_s = 0;
          }
          if (seg.quality_score > 3) {
            console.warn(`[gemini-segments] Coercing unusable segment ${i} quality_score ${seg.quality_score} → 3`);
            seg.quality_score = 3;
          }
          if (seg.best_used_as.length > 0) {
            seg.best_used_as = [];
          }
        }
        validSegments.push(seg);
      } else {
        console.warn(
          `[gemini-segments] Dropping invalid segment ${i}: ${parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        );
      }
    }

    if (validSegments.length === 0) {
      throw new Error(
        `Gemini returned ${rawSegments.length} segments but none passed validation. Model: ${MODEL_ID}`,
      );
    }

    // 6. Sort by start_s ascending
    validSegments.sort((a, b) => a.start_s - b.start_s);

    console.log(
      `[gemini-segments] ${validSegments.length}/${rawSegments.length} segments validated (${durationSeconds.toFixed(1)}s source)`,
    );
    return validSegments;
  } finally {
    // 7. Delete uploaded file from Gemini — don't leak files
    try {
      await fileManager.deleteFile(fileName);
      console.log(`[gemini-segments] Cleaned up Gemini file: ${fileName}`);
    } catch (delErr) {
      console.warn(`[gemini-segments] Failed to delete Gemini file ${fileName}: ${(delErr as Error).message}`);
    }
  }
}
