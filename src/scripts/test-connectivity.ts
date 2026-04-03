import { supabaseAdmin } from '../config/supabase.js';
import { createRedisConnection } from '../config/redis.js';
import { uploadFile, downloadFile, deleteFile } from '../lib/r2-storage.js';

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

console.log('\n🔌 Testing connectivity...\n');

// ── Supabase ──
console.log('Supabase:');
await test('Query brand_configs', async () => {
  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .select('brand_id, brand_name');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('No brands found');
  console.log(`     Found ${data.length} brands: ${data.map((b: { brand_id: string }) => b.brand_id).join(', ')}`);
});

// ── Redis ──
console.log('\nRedis:');
await test('PING Upstash', async () => {
  const redis = createRedisConnection();
  const res = await redis.ping();
  if (res !== 'PONG') throw new Error(`Expected PONG, got: ${res}`);
  await redis.quit();
});

// ── R2 ──
console.log('\nCloudflare R2:');
const testKey = 'test-connectivity.txt';
const testContent = `connectivity-test-${Date.now()}`;

await test('PUT test file', async () => {
  await uploadFile(testKey, Buffer.from(testContent), 'text/plain');
});

await test('GET test file', async () => {
  const stream = await downloadFile(testKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const result = Buffer.concat(chunks).toString();
  if (result !== testContent) throw new Error(`Content mismatch: expected "${testContent}", got "${result}"`);
});

await test('DELETE test file', async () => {
  await deleteFile(testKey);
});

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
