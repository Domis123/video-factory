import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile, stat, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { exec } from './exec.js';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export interface ClipAnalysis {
  content_type: string;
  mood: string;
  quality_score: number;
  has_speech: boolean;
  transcript_summary: string | null;
  visual_elements: string[];
  usable_segments: Array<{ start_s: number; end_s: number; description: string }>;
  tags: string[];
  detailed_description: string;
}

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

const ANALYSIS_PROMPT = `You are a video content analyzer for a social media video production pipeline. Analyze this UGC (user-generated content) clip and return a JSON object with these exact fields:

{
  "content_type": one of: "talking-head", "product-demo", "b-roll", "lifestyle", "unboxing", "testimonial", "workout", "cooking", "before-after",
  "mood": one of: "energetic", "calm", "inspirational", "funny", "serious", "casual",
  "quality_score": 1-10 integer based on lighting, camera stability, audio clarity, framing,
  "has_speech": true/false whether someone is speaking,
  "transcript_summary": if has_speech is true, a brief summary of what is said (1-2 sentences). null if no speech,
  "visual_elements": array of what's visible, e.g. ["person", "product", "kitchen", "food", "gym", "nature", "outdoor"],
  "usable_segments": array of the best sub-clips with timestamps, e.g. [{"start_s": 0, "end_s": 8, "description": "Person demonstrating yoga pose with good lighting"}],
  "tags": array of descriptive tags for search, e.g. ["yoga", "stretching", "indoor", "bright-lighting", "female-instructor"],
  "detailed_description": 2-3 sentence description of the full clip that will help AI agents select this clip for the right video context
}

Be specific and accurate with timestamps. Identify the most usable sub-sections — skip shaky, dark, or low-quality parts. Return ONLY valid JSON, no markdown or explanation.`;

export async function analyzeClip(filePath: string): Promise<ClipAnalysis> {
  const ext = extname(filePath).toLowerCase();
  let mimeType = MIME_MAP[ext] ?? 'video/mp4';
  let analysisPath = filePath;
  let downscalePath: string | null = null;

  try {
    // Downscale large clips to 720p before sending to Gemini.
    // 4K clips can be 100MB+ which would balloon to 130MB+ as base64 in JS heap
    // and OOM the worker. Gemini's vision model doesn't need full 4K resolution.
    const fileStat = await stat(filePath);
    const fileSizeMb = fileStat.size / (1024 * 1024);
    if (fileSizeMb > 50) {
      downscalePath = `/tmp/gemini-${randomUUID()}.mp4`;
      console.log(`[gemini] Clip is ${fileSizeMb.toFixed(0)}MB, downscaling to 720p for analysis`);
      const dsResult = await exec({
        command: 'ffmpeg',
        args: [
          '-i', filePath,
          '-vf', 'scale=720:-2',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '28',
          '-an',
          '-y', downscalePath,
        ],
      });
      if (dsResult.exitCode !== 0) {
        throw new Error(`ffmpeg downscale failed (exit ${dsResult.exitCode}): ${dsResult.stderr}`);
      }
      analysisPath = downscalePath;
      mimeType = 'video/mp4';
    }

    const videoData = await readFile(analysisPath);
    const base64 = videoData.toString('base64');

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { text: ANALYSIS_PROMPT },
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

    const text = result.response.text();

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[gemini] Could not parse response, using defaults');
      return fallbackAnalysis();
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as ClipAnalysis;
      return validateAnalysis(parsed);
    } catch {
      console.warn('[gemini] JSON parse error, using defaults');
      return fallbackAnalysis();
    }
  } finally {
    if (downscalePath) {
      await unlink(downscalePath).catch(() => {});
    }
  }
}

function validateAnalysis(raw: ClipAnalysis): ClipAnalysis {
  const validContentTypes = [
    'talking-head', 'product-demo', 'b-roll', 'lifestyle', 'unboxing',
    'testimonial', 'workout', 'cooking', 'before-after',
  ];
  const validMoods = ['energetic', 'calm', 'inspirational', 'funny', 'serious', 'casual'];

  return {
    content_type: validContentTypes.includes(raw.content_type) ? raw.content_type : 'b-roll',
    mood: validMoods.includes(raw.mood) ? raw.mood : 'neutral',
    quality_score: Math.min(10, Math.max(1, Math.round(raw.quality_score ?? 5))),
    has_speech: !!raw.has_speech,
    transcript_summary: raw.has_speech ? (raw.transcript_summary ?? null) : null,
    visual_elements: Array.isArray(raw.visual_elements) ? raw.visual_elements : [],
    usable_segments: Array.isArray(raw.usable_segments)
      ? raw.usable_segments.filter((s) => typeof s.start_s === 'number' && typeof s.end_s === 'number')
      : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    detailed_description: raw.detailed_description ?? '',
  };
}

function fallbackAnalysis(): ClipAnalysis {
  return {
    content_type: 'b-roll',
    mood: 'neutral',
    quality_score: 5,
    has_speech: false,
    transcript_summary: null,
    visual_elements: [],
    usable_segments: [],
    tags: [],
    detailed_description: '',
  };
}
