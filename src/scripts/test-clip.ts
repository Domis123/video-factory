import { embedText, embedImage } from '../lib/clip-embed.js';
import sharp from 'sharp';

let passed = 0;
let failed = 0;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already L2-normalized, so dot = cosine
}

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

console.log('\n🧪 CLIP Embedder Test\n');

// ── Test 1: Text identity ──
console.log('Text identity:');
await test('Same string twice → cosine > 0.9999', async () => {
  const a = await embedText('woman doing yoga on a mat');
  const b = await embedText('woman doing yoga on a mat');
  const sim = cosine(a, b);
  console.log(`     similarity: ${sim.toFixed(6)}`);
  if (sim < 0.9999) throw new Error(`Expected > 0.9999, got ${sim}`);
});

// ── Test 2: Text-text semantic similarity ──
console.log('\nText-text semantic:');
await test('"woman doing yoga on a mat" vs "person stretching on a yoga mat" → cosine > 0.85', async () => {
  const a = await embedText('woman doing yoga on a mat');
  const b = await embedText('person stretching on a yoga mat');
  const sim = cosine(a, b);
  console.log(`     similarity: ${sim.toFixed(6)}`);
  if (sim < 0.85) throw new Error(`Expected > 0.85, got ${sim}`);
});

// ── Test 3: Cross-modal (image + text) ──
console.log('\nCross-modal (image ↔ text):');
await test('Synthetic yoga-green image vs "yoga pose" → cosine > 0.20', async () => {
  // Generate a simple synthetic test image (green-toned, 224×224)
  // In a real scenario this would be a keyframe; here we use a solid
  // colour block so the test doesn't depend on external files.
  const testImage = await sharp({
    create: { width: 224, height: 224, channels: 3, background: { r: 80, g: 140, b: 80 } },
  })
    .jpeg()
    .toBuffer();

  const imgVec = await embedImage(testImage);
  const txtVec = await embedText('yoga pose');
  const sim = cosine(imgVec, txtVec);
  console.log(`     similarity: ${sim.toFixed(6)}`);
  if (sim < 0.20) throw new Error(`Expected > 0.20, got ${sim}`);
});

// ── Summary ──
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
