import { analyzeClipSegments } from '../lib/gemini-segments.js';
import { extractKeyframe } from '../lib/keyframe-extractor.js';
import { buildProbeCommand } from '../lib/ffmpeg.js';
import { execOrThrow } from '../lib/exec.js';
import { stat } from 'node:fs/promises';

const videoPath = process.argv[2];
if (!videoPath) {
  console.error('Usage: npm run test:segment-analyzer -- /path/to/video.mov');
  process.exit(1);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}: ${msg}`);
    failed++;
  }
}

console.log('\n🧪 Segment Analyzer + Keyframe Extractor Test\n');

// ── Get video duration via ffprobe ──
console.log('Probe:');
let duration = 0;
await test('FFprobe video for duration', async () => {
  const raw = await execOrThrow(buildProbeCommand(videoPath));
  const info = JSON.parse(raw);
  duration = parseFloat(info.format?.duration ?? '0');
  const video = info.streams?.find((s: Record<string, unknown>) => s.codec_type === 'video');
  console.log(`     Duration: ${duration.toFixed(1)}s, Resolution: ${video?.width}x${video?.height}`);
  if (duration === 0) throw new Error('Duration is 0');
});

if (duration === 0) {
  console.error('\nCannot proceed without valid duration.');
  process.exit(1);
}

// ── Run segment analysis ──
console.log('\nSegment analysis:');
let segments: Awaited<ReturnType<typeof analyzeClipSegments>> = [];
await test('Gemini Pro returns at least 1 segment', async () => {
  segments = await analyzeClipSegments(
    videoPath,
    duration,
    'Brand: nordpilates. Pilates and movement content for women.',
  );
  console.log(`     Got ${segments.length} segments`);
  if (segments.length === 0) throw new Error('No segments returned');
});

// Print full segment array for manual inspection
if (segments.length > 0) {
  console.log('\nSegment details:');
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    console.log(
      `  [${i}] ${s.start_s.toFixed(1)}s–${s.end_s.toFixed(1)}s (${(s.end_s - s.start_s).toFixed(1)}s) ` +
        `type:${s.segment_type} motion:${s.motion_intensity} quality:${s.quality_score} speech:${s.has_speech}`,
    );
    console.log(`       ${s.description}`);
    console.log(`       tags: ${s.visual_tags.join(', ')}`);
    console.log(`       best_used_as: ${s.best_used_as.join(', ')}`);
  }
}

// ── Validate: no overlaps ──
console.log('\nValidation:');
await test('Segments do not overlap', async () => {
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start_s < segments[i - 1].end_s - 0.01) {
      throw new Error(
        `Segment ${i} starts at ${segments[i].start_s}s but segment ${i - 1} ends at ${segments[i - 1].end_s}s`,
      );
    }
  }
});

// ── Validate: coverage > 50% ──
await test('Total covered duration > 50% of source', async () => {
  const covered = segments.reduce((sum, s) => sum + (s.end_s - s.start_s), 0);
  const pct = (covered / duration) * 100;
  console.log(`     Covered: ${covered.toFixed(1)}s / ${duration.toFixed(1)}s (${pct.toFixed(1)}%)`);
  if (pct < 50) throw new Error(`Only ${pct.toFixed(1)}% covered, need > 50%`);
});

// ── Validate: segment_type distribution ──
const typeCounts: Record<string, number> = {};
for (const s of segments) {
  typeCounts[s.segment_type] = (typeCounts[s.segment_type] ?? 0) + 1;
}
const distStr = Object.entries(typeCounts).map(([k, v]) => `${k}=${v}`).join(', ');
console.log(`     Distribution: ${distStr}`);

await test('At least 2 distinct segment_types (clips >30s)', async () => {
  if (duration <= 30) {
    console.log('     Skipped (clip ≤30s)');
    return;
  }
  const distinctTypes = Object.keys(typeCounts).length;
  if (distinctTypes < 2) {
    throw new Error(`Only ${distinctTypes} distinct segment_type(s): ${Object.keys(typeCounts).join(', ')}. Expected ≥2 for a ${duration.toFixed(0)}s clip.`);
  }
  console.log(`     ${distinctTypes} distinct types`);
});

// ── Keyframe extraction ──
console.log('\nKeyframe extraction:');
await test('Extract keyframe at first segment midpoint', async () => {
  const midpoint = (segments[0].start_s + segments[0].end_s) / 2;
  const outPath = '/tmp/test-keyframe.jpg';
  await extractKeyframe(videoPath, midpoint, outPath);
  const fileStat = await stat(outPath);
  console.log(`     Keyframe at ${midpoint.toFixed(1)}s → ${outPath} (${fileStat.size} bytes)`);
  if (fileStat.size === 0) throw new Error('Keyframe file is empty');
});

// ── Summary ──
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
