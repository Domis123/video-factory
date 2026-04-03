import type { WordTimestamp, TranscriptionResult } from './transcriber.js';
import type { ContextPacket } from '../types/database.js';

export interface SyncCheckResult {
  passed: boolean;
  maxDriftMs: number;
  segmentResults: SegmentSyncResult[];
  captionResults: CaptionSyncResult[];
  needsRetry: boolean;
  suggestedOffsetMs: number;
}

export interface SegmentSyncResult {
  segmentId: number;
  driftMs: number;
  passed: boolean;
  isTalkingHead: boolean;
}

export interface CaptionSyncResult {
  segmentId: number;
  passed: boolean;
  issues: string[];
  wordCount: number;
  avgWordDurationMs: number;
}

const DRIFT_WARN_MS = 100;
const DRIFT_FAIL_MS = 200;

export function checkSync(
  transcriptions: TranscriptionResult[],
  contextPacket: ContextPacket,
  clipDurations?: Map<number, number>,
): SyncCheckResult {
  const segmentResults: SegmentSyncResult[] = [];
  const captionResults: CaptionSyncResult[] = [];
  let maxDriftMs = 0;

  for (const transcript of transcriptions) {
    if (transcript.words.length === 0) continue;

    // Determine if this is a talking-head segment (stricter sync requirements)
    const briefSegment = contextPacket.brief.segments.find(
      (s) => s.segment_id === transcript.segmentId,
    );
    const clipReqs = briefSegment?.clip_requirements;
    const contentTypes = Array.isArray(clipReqs?.content_type) ? clipReqs.content_type : [];
    const isTalkingHead = contentTypes.includes('talking-head');

    // Audio-to-video drift check
    const driftMs = estimateDrift(transcript.words);
    const threshold = isTalkingHead ? DRIFT_WARN_MS : DRIFT_FAIL_MS;
    const avPassed = driftMs <= threshold;

    segmentResults.push({
      segmentId: transcript.segmentId,
      driftMs,
      passed: avPassed,
      isTalkingHead,
    });

    maxDriftMs = Math.max(maxDriftMs, driftMs);

    // Caption sync check
    const clipDur = clipDurations?.get(transcript.segmentId) ?? 0;
    const captionResult = checkCaptionSync(
      transcript.words,
      clipDur,
      transcript.segmentId,
    );
    captionResults.push(captionResult);
  }

  const avPassed = segmentResults.every((r) => r.passed);
  const captionsPassed = captionResults.every((r) => r.passed);
  const allPassed = avPassed && captionsPassed;
  const needsRetry = !allPassed && maxDriftMs <= 500;
  const suggestedOffsetMs = needsRetry ? -Math.round(maxDriftMs / 2) : 0;

  if (!captionsPassed) {
    const issues = captionResults.filter((r) => !r.passed);
    for (const r of issues) {
      console.log(`[sync-check] Caption issues in segment ${r.segmentId}: ${r.issues.join('; ')}`);
    }
  }

  console.log(
    `[sync-check] A/V drift: ${maxDriftMs}ms (${avPassed ? 'ok' : 'FAIL'}), captions: ${captionsPassed ? 'ok' : 'FAIL'}`,
  );

  return {
    passed: allPassed,
    maxDriftMs,
    segmentResults,
    captionResults,
    needsRetry,
    suggestedOffsetMs,
  };
}

// ── Caption Sync ──

function checkCaptionSync(
  words: WordTimestamp[],
  clipDurationSec: number,
  segmentId: number,
): CaptionSyncResult {
  if (words.length === 0) {
    return { segmentId, passed: true, issues: [], wordCount: 0, avgWordDurationMs: 0 };
  }

  const issues: string[] = [];

  // Check 1: Monotonically increasing timestamps (allow 50ms tolerance)
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].end - 0.05) {
      issues.push(`Word "${words[i].word}" overlaps previous word`);
      if (issues.length >= 5) break; // cap noise
    }
  }

  // Check 2: No large gaps (>2s) in continuous speech
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > 2.0) {
      issues.push(`${gap.toFixed(1)}s gap between "${words[i - 1].word}" and "${words[i].word}"`);
    }
  }

  // Check 3: Word durations are reasonable (30ms - 2000ms)
  for (const w of words) {
    const dur = (w.end - w.start) * 1000;
    if (dur > 2000) issues.push(`"${w.word}" duration ${dur.toFixed(0)}ms (too long)`);
    if (dur < 30) issues.push(`"${w.word}" duration ${dur.toFixed(0)}ms (too short)`);
  }

  // Check 4: Captions don't extend beyond clip duration
  if (clipDurationSec > 0 && words[words.length - 1].end > clipDurationSec + 0.5) {
    issues.push(
      `Captions extend beyond clip (${words[words.length - 1].end.toFixed(1)}s > ${clipDurationSec.toFixed(1)}s)`,
    );
  }

  const durations = words.map((w) => (w.end - w.start) * 1000);
  const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;

  return {
    segmentId,
    passed: issues.length === 0,
    issues,
    wordCount: words.length,
    avgWordDurationMs: Math.round(avgDur),
  };
}

// ── A/V Drift Estimation ──

function estimateDrift(words: WordTimestamp[]): number {
  if (words.length < 3) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = (words[i].start - words[i - 1].end) * 1000;
    gaps.push(gap);
  }

  // Negative gaps = words overlapping = definitely out of sync
  const negativeGaps = gaps.filter((g) => g < -50);
  if (negativeGaps.length > 0) {
    return Math.abs(Math.min(...negativeGaps));
  }

  // High variance in word gaps suggests drift
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const stdDev = Math.sqrt(variance);

  return Math.round(Math.max(0, stdDev - 100));
}
