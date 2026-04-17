import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildAudioExtractCommand, buildProbeCommand } from '../lib/ffmpeg.js';
import { execOrThrow, exec } from '../lib/exec.js';
import { env } from '../config/env.js';

export interface WordTimestamp {
  word: string;
  start: number;  // seconds
  end: number;    // seconds
}

export interface TranscriptionResult {
  segmentId: number;
  clipPath: string;
  srtPath: string;
  jsonPath: string;
  words: WordTimestamp[];
  fullText: string;
}

// whisper.cpp binary + model paths — configured via WHISPER_BIN / WHISPER_MODEL in env
const WHISPER_BIN = env.WHISPER_BIN;
const WHISPER_MODEL = env.WHISPER_MODEL;

export async function transcribeClip(
  clipPath: string,
  segmentId: number,
  outputDir: string,
  segmentWindow?: { startSec: number; endSec: number },
): Promise<TranscriptionResult> {
  await mkdir(outputDir, { recursive: true });

  const wavPath = join(outputDir, `seg${segmentId}.wav`);
  const outputBase = join(outputDir, `seg${segmentId}`);

  // 1. Extract audio as 16kHz mono WAV (whisper.cpp requirement).
  //
  // The Day-4 bug: clip-prep is supposed to trim each clip to the curator's
  // segment window, but in practice the normalized clip on disk sometimes
  // ends up containing the FULL source (e.g. seg4 was 215s instead of 8s),
  // which made whisper transcribe minutes of unrelated audio.
  //
  // Defense-in-depth fix: probe the clip and clamp audio extraction to the
  // curator-selected window. If clip-prep already trimmed (file duration ~=
  // window length), seek from 0; otherwise seek to start_s. Either way the
  // WAV ends up being exactly the segment window long.
  let extractOpts: { startSec?: number; durationSec?: number } = {};
  if (segmentWindow) {
    const expectedDuration = segmentWindow.endSec - segmentWindow.startSec;
    if (expectedDuration > 0) {
      const actualDuration = await probeClipDuration(clipPath);
      // 2s tolerance covers the keyframe-snap drift from `-c copy` trims.
      const alreadyTrimmed = actualDuration > 0 && actualDuration <= expectedDuration + 2;
      extractOpts = alreadyTrimmed
        ? { durationSec: expectedDuration }
        : { startSec: segmentWindow.startSec, durationSec: expectedDuration };
      console.log(
        `[transcriber] Segment ${segmentId} window ${segmentWindow.startSec}-${segmentWindow.endSec}s ` +
        `(file=${actualDuration.toFixed(1)}s, ${alreadyTrimmed ? 'trimmed' : 'full'})`,
      );
    }
  }
  // Probe for audio streams — UGC clips filmed with mic off have none.
  const probeResult = await exec({
    command: 'ffprobe',
    args: ['-v', 'quiet', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', clipPath],
  });
  if (!probeResult.stdout.trim()) {
    console.log(`[transcriber] Segment ${segmentId}: no audio stream, skipping`);
    return { segmentId, clipPath, srtPath: '', jsonPath: '', words: [], fullText: '' };
  }

  console.log(`[transcriber] Extracting audio from segment ${segmentId}`);
  await execOrThrow(buildAudioExtractCommand(clipPath, wavPath, extractOpts));

  // 2. Run whisper.cpp with word-level timestamps
  console.log(`[transcriber] Running whisper.cpp on segment ${segmentId}`);
  const result = await exec({
    command: WHISPER_BIN,
    args: [
      '-m', WHISPER_MODEL,
      '-f', wavPath,
      '--output-srt',
      '--output-json',
      '--word-timestamps',
      '--max-len', '40',
      '-of', outputBase,
    ],
  });

  if (result.exitCode !== 0) {
    console.warn(`[transcriber] whisper.cpp warning (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
  }

  // 3. Parse word timestamps from JSON output
  const jsonPath = `${outputBase}.json`;
  const srtPath = `${outputBase}.srt`;
  let words: WordTimestamp[] = [];
  let fullText = '';

  try {
    const raw = await readFile(jsonPath, 'utf-8');
    const whisperOutput = JSON.parse(raw);

    // whisper.cpp JSON format: { transcription: [{ timestamps: { from, to }, text, ... }] }
    // or with word timestamps: tokens array with timestamps
    if (whisperOutput.transcription) {
      for (const segment of whisperOutput.transcription) {
        if (segment.tokens) {
          for (const token of segment.tokens) {
            if (token.text?.trim()) {
              words.push({
                word: token.text.trim(),
                start: msToSec(token.timestamps?.from ?? token.t0 ?? 0),
                end: msToSec(token.timestamps?.to ?? token.t1 ?? 0),
              });
            }
          }
        }
        fullText += (segment.text ?? '') + ' ';
      }
    }
    fullText = fullText.trim();
  } catch {
    console.warn(`[transcriber] Could not parse whisper JSON for segment ${segmentId}`);
  }

  // Fallback: try SRT if JSON didn't produce words
  if (words.length === 0) {
    try {
      const srtContent = await readFile(srtPath, 'utf-8');
      const parsed = parseSrt(srtContent);
      words = parsed.words;
      if (!fullText) fullText = parsed.fullText;
    } catch {
      console.warn(`[transcriber] No SRT output for segment ${segmentId}`);
    }
  }

  console.log(`[transcriber] Segment ${segmentId}: ${words.length} words, "${fullText.slice(0, 60)}..."`);

  return { segmentId, clipPath, srtPath, jsonPath, words, fullText };
}

export async function transcribeAll(
  clips: Array<{
    segmentId: number;
    localPath: string;
    hasSpeech?: boolean;
    segmentWindow?: { startSec: number; endSec: number };
  }>,
  workDir: string,
): Promise<TranscriptionResult[]> {
  const outputDir = join(workDir, 'transcripts');
  const results: TranscriptionResult[] = [];

  for (const clip of clips) {
    if (clip.hasSpeech === false) {
      console.log(`[transcriber] Skipping segment ${clip.segmentId} (no speech)`);
      results.push({
        segmentId: clip.segmentId,
        clipPath: clip.localPath,
        srtPath: '',
        jsonPath: '',
        words: [],
        fullText: '',
      });
      continue;
    }
    const result = await transcribeClip(
      clip.localPath,
      clip.segmentId,
      outputDir,
      clip.segmentWindow,
    );
    results.push(result);
  }

  return results;
}

// Probe a clip's duration in seconds via ffprobe. Returns 0 on failure so the
// caller can fall back to the "full clip" extraction path.
async function probeClipDuration(clipPath: string): Promise<number> {
  try {
    const stdout = await execOrThrow(buildProbeCommand(clipPath));
    const info = JSON.parse(stdout);
    const dur = info?.format?.duration;
    return dur ? parseFloat(dur) : 0;
  } catch {
    return 0;
  }
}

// ── Helpers ──

function msToSec(ms: string | number): number {
  const val = typeof ms === 'string' ? parseInt(ms, 10) : ms;
  return val / 1000;
}

function parseSrt(srt: string): { words: WordTimestamp[]; fullText: string } {
  const words: WordTimestamp[] = [];
  const lines = srt.split('\n');
  let fullText = '';
  let i = 0;

  while (i < lines.length) {
    // Skip sequence number
    if (/^\d+$/.test(lines[i]?.trim() ?? '')) {
      i++;
    }
    // Parse timestamp line: 00:00:01,000 --> 00:00:04,000
    const tsMatch = lines[i]?.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/,
    );
    if (tsMatch) {
      const start = parseTimestamp(tsMatch[1], tsMatch[2], tsMatch[3], tsMatch[4]);
      const end = parseTimestamp(tsMatch[5], tsMatch[6], tsMatch[7], tsMatch[8]);
      i++;
      // Collect text lines until blank line
      let text = '';
      while (i < lines.length && lines[i]?.trim()) {
        text += lines[i]!.trim() + ' ';
        i++;
      }
      text = text.trim();
      if (text) {
        // Split into individual words with interpolated timestamps
        const wordList = text.split(/\s+/);
        const duration = end - start;
        wordList.forEach((w, idx) => {
          const wordStart = start + (duration * idx) / wordList.length;
          const wordEnd = start + (duration * (idx + 1)) / wordList.length;
          words.push({ word: w, start: wordStart, end: wordEnd });
        });
        fullText += text + ' ';
      }
    }
    i++;
  }

  return { words, fullText: fullText.trim() };
}

function parseTimestamp(h: string, m: string, s: string, ms: string): number {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}
