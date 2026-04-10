/**
 * VPS live preflight — read-only health checks for all external dependencies.
 *
 * Run on the VPS:
 *   cd /home/video-factory && npx tsx src/scripts/vps-preflight-live.ts
 *
 * Checks in order:
 *   1. Redis (PING via ioredis with Upstash TLS opts)
 *   2. Anthropic API (cheap /v1/messages call, max_tokens=1)
 *   3. Gemini API (GET /models list)
 *   4. R2 (list 5 keys under assets/nordpilates/)
 *   5. Supabase counts (assets for nordpilates, music_tracks total, 3 seeded brand_configs)
 *   6. Brand seed verification — prints allowed_video_types + color_grade_preset for the 3 MVP brands
 *
 * All checks are independent. A failure in one does not abort the rest.
 * Exit code: 0 if everything passes, 1 if any check fails.
 */

import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { createRedisConnection } from '../config/redis.js';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

interface CheckResult {
  name: string;
  ok: boolean;
  details: string;
}

const results: CheckResult[] = [];

function pass(name: string, details: string) {
  results.push({ name, ok: true, details });
  console.log(`✅ ${name}: ${details}`);
}

function fail(name: string, details: string) {
  results.push({ name, ok: false, details });
  console.error(`❌ ${name}: ${details}`);
}

async function checkRedis(): Promise<void> {
  const r = createRedisConnection();
  try {
    const reply = await r.ping();
    pass('Redis', `PING → ${reply}`);
  } catch (err) {
    fail('Redis', (err as Error).message);
  } finally {
    r.disconnect();
  }
}

async function checkAnthropic(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    fail('Anthropic', 'ANTHROPIC_API_KEY not set in env');
    return;
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.ok) {
      pass('Anthropic', `HTTP ${res.status}`);
    } else {
      const body = await res.text();
      fail('Anthropic', `HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  } catch (err) {
    fail('Anthropic', (err as Error).message);
  }
}

async function checkGemini(): Promise<void> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { models?: unknown[] };
      pass('Gemini', `HTTP ${res.status} (${json.models?.length ?? 0} models listed)`);
    } else {
      const body = await res.text();
      fail('Gemini', `HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  } catch (err) {
    fail('Gemini', (err as Error).message);
  }
}

async function checkR2(): Promise<void> {
  try {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: 'assets/nordpilates/',
        MaxKeys: 5,
      }),
    );
    pass('R2', `assets/nordpilates/ → ${res.KeyCount ?? 0} keys`);
  } catch (err) {
    fail('R2', (err as Error).message);
  }
}

async function checkSupabase(): Promise<void> {
  try {
    const [assetsRes, musicRes, brandsRes] = await Promise.all([
      supabaseAdmin
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', 'nordpilates'),
      supabaseAdmin.from('music_tracks').select('id', { count: 'exact', head: true }),
      supabaseAdmin
        .from('brand_configs')
        .select('brand_id, brand_name, allowed_video_types, color_grade_preset, logo_r2_key')
        .in('brand_id', ['nordpilates', 'ketoway', 'carnimeat']),
    ]);

    if (assetsRes.error) throw new Error(`assets: ${assetsRes.error.message}`);
    if (musicRes.error) throw new Error(`music_tracks: ${musicRes.error.message}`);
    if (brandsRes.error) throw new Error(`brand_configs: ${brandsRes.error.message}`);

    pass('Supabase assets (nordpilates)', `${assetsRes.count ?? 0} rows`);
    pass('Supabase music_tracks', `${musicRes.count ?? 0} rows`);
    pass('Supabase brand_configs (mvp 3)', `${brandsRes.data?.length ?? 0} rows`);

    console.log('\n── Brand seed verification ──');
    console.log(JSON.stringify(brandsRes.data, null, 2));
  } catch (err) {
    fail('Supabase', (err as Error).message);
  }
}

async function checkFallbackMusicTrack(): Promise<void> {
  const id = env.FALLBACK_MUSIC_TRACK_ID;
  if (!id) {
    fail('FALLBACK_MUSIC_TRACK_ID', 'empty — planner will run without background music');
    return;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('music_tracks')
      .select('id, title, artist, duration_seconds, r2_key')
      .eq('id', id)
      .single();
    if (error || !data) {
      fail('FALLBACK_MUSIC_TRACK_ID', `${id} not found in music_tracks: ${error?.message ?? 'no row'}`);
      return;
    }
    pass(
      'FALLBACK_MUSIC_TRACK_ID',
      `${data.title ?? data.id} (${data.duration_seconds}s, r2://${data.r2_key})`,
    );
  } catch (err) {
    fail('FALLBACK_MUSIC_TRACK_ID', (err as Error).message);
  }
}

async function main() {
  console.log('\n🩺 VPS live preflight\n');
  console.log(`Worker: ${env.WORKER_ID}`);
  console.log(`Feature flags:`);
  console.log(`  ENABLE_BEAT_SYNC=${env.ENABLE_BEAT_SYNC}`);
  console.log(`  ENABLE_COLOR_GRADING=${env.ENABLE_COLOR_GRADING}`);
  console.log(`  ENABLE_MUSIC_SELECTION=${env.ENABLE_MUSIC_SELECTION}`);
  console.log(`  ENABLE_DYNAMIC_PACING=${env.ENABLE_DYNAMIC_PACING}`);
  console.log(`  ENABLE_AUDIO_DUCKING=${env.ENABLE_AUDIO_DUCKING}`);
  console.log(`  ENABLE_CRF18_ENCODING=${env.ENABLE_CRF18_ENCODING}`);
  console.log(`  FALLBACK_MUSIC_TRACK_ID=${env.FALLBACK_MUSIC_TRACK_ID || '(empty)'}`);
  console.log('');

  await checkRedis();
  await checkAnthropic();
  await checkGemini();
  await checkR2();
  await checkSupabase();
  await checkFallbackMusicTrack();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n── Summary ──`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Preflight crashed:', err);
  process.exit(1);
});
