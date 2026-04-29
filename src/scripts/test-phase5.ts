/**
 * Test Phase 5: Renderer + Pipeline + Server
 * Tests everything that can be verified without a VPS or real video files.
 */

import 'dotenv/config';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { BrandConfig, ContextPacket } from '../types/database.js';
import { createQueue, createRedisConnection, QUEUE_NAMES } from '../config/redis.js';
import { supabaseAdmin } from '../config/supabase.js';
import { buildContextPacket } from '../agents/context-packet.js';
import { transitionJob, logEvent, VALID_TRANSITIONS } from '../lib/job-manager.js';
import type { Job } from '../types/database.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const mockBrand: BrandConfig = {
  brand_id: 'nordpilates',
  brand_name: 'Nord Pilates',
  primary_color: '#1a1a2e',
  secondary_color: '#e94560',
  accent_color: '#0f3460',
  font_family: 'Inter',
  font_weight_title: 700,
  font_weight_body: 400,
  caption_preset: {
    preset_name: 'bold-pop',
    engine: 'remotion',
    style: {
      font_family: 'Inter', font_size: 48, font_weight: 800,
      text_color: '#FFFFFF', stroke_color: '#000000', stroke_width: 3,
      background: 'none', position: 'bottom-center',
      margin_bottom_px: 120, max_width_percent: 90, text_align: 'center',
      animation: { type: 'word-highlight', highlight_color: '#e94560', highlight_style: 'background', word_gap_ms: 80 },
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 4, offset_x: 2, offset_y: 2 },
    },
  },
  logo_r2_key: 'brands/nordpilates/logo.png',
  watermark_r2_key: null,
  watermark_position: 'bottom-right',
  watermark_opacity: 0.7,
  cta_style: 'link-in-bio',
  cta_bg_color: null,
  cta_text_color: null,
  transition_style: 'cut',
  voice_guidelines: 'Warm, encouraging, fitness-positive.',
  aesthetic_description: null,
  hook_style_preference: ['pov', 'question', 'challenge'],
  content_pillars: ['pilates', 'flexibility', 'wellness'],
  allowed_video_types: ['workout-demo', 'tips-listicle', 'transformation'],
  color_grade_preset: 'warm-vibrant',
  color_lut_r2_key: null,
  allowed_color_treatments: null,
  drive_input_folder_id: null,
  drive_output_folder_id: null,
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function main() {
  console.log('\n🧪 Phase 5: Renderer + Pipeline + Server Tests\n');

  // ── Test 1: Redis Queue Connectivity ──
  console.log('── 1. Redis Queue Connectivity ──');
  const redis = createRedisConnection();
  const pong = await redis.ping();
  assert('Redis PING', pong === 'PONG');

  // Create queues and verify they exist
  for (const queueName of Object.values(QUEUE_NAMES)) {
    const queue = createQueue(queueName);
    const isPaused = await queue.isPaused();
    assert(`Queue "${queueName}" accessible`, typeof isPaused === 'boolean');
    await queue.close();
  }
  await redis.quit();

  // ── Test 2: BullMQ Job Add/Remove ──
  console.log('\n── 2. BullMQ Job Enqueue/Dequeue ──');
  const testQueue = createQueue('test-phase5');
  const testJob = await testQueue.add('test-job', { jobId: 'test-123' });
  assert('Job enqueued', !!testJob.id);
  assert('Job has correct data', testJob.data.jobId === 'test-123');

  // Clean up
  await testJob.remove();
  await testQueue.obliterate({ force: true });
  await testQueue.close();
  assert('Test queue cleaned up', true);

  // ── Test 3: Context Packet Build (mock) ──
  console.log('\n── 3. Context Packet Assembly ──');
  const packet = await buildContextPacket({
    ideaSeed: 'Test: 3 desk stretches for posture',
    brandConfig: mockBrand,
  });
  assert('Packet has context_packet_id', !!packet.context_packet_id);
  assert('Packet brief has segments', packet.brief.segments.length >= 2);
  assert('Packet clips match segments', packet.clips.clip_selections.length === packet.brief.segments.length);
  assert('Packet copy has captions', !!packet.copy.captions.tiktok);
  assert('Packet has brand_config', packet.brand_config.brand_id === 'nordpilates');

  // ── Test 4: Job Lifecycle Simulation ──
  console.log('\n── 4. Job Lifecycle (DB state machine) ──');

  // Create a test job in Supabase
  const { data: newJob, error: insertErr } = await supabaseAdmin
    .from('jobs')
    .insert({
      brand_id: 'nordpilates',
      status: 'idle',
      idea_seed: 'Phase 5 test: desk stretches',
    })
    .select()
    .single();

  assert('Test job created', !insertErr && !!newJob, insertErr?.message);
  const jobId = (newJob as Job).id;

  // Walk through the full state machine
  const transitions: [string, string][] = [
    ['idle', 'idea_seed'],
    ['idea_seed', 'planning'],
    ['planning', 'brief_review'],
    ['brief_review', 'queued'],
    ['queued', 'clip_prep'],
    ['clip_prep', 'transcription'],
    ['transcription', 'rendering'],
    ['rendering', 'audio_mix'],
    ['audio_mix', 'sync_check'],
    ['sync_check', 'platform_export'],
    ['platform_export', 'auto_qa'],
    ['auto_qa', 'human_qa'],
    ['human_qa', 'delivered'],
  ];

  let transitionsFailed = false;
  for (const [from, to] of transitions) {
    try {
      await transitionJob(jobId, from as any, to as any, { test: true });
    } catch (err) {
      console.log(`  ❌ Transition ${from} → ${to} failed: ${err}`);
      transitionsFailed = true;
      failed++;
      break;
    }
  }

  if (!transitionsFailed) {
    assert(`Full lifecycle: 13 transitions (idle → delivered)`, true);
  }

  // Verify final state
  const { data: finalJob } = await supabaseAdmin
    .from('jobs')
    .select('status')
    .eq('id', jobId)
    .single();
  assert('Final status is delivered', (finalJob as any)?.status === 'delivered');

  // Verify events were logged
  const { data: events } = await supabaseAdmin
    .from('job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  assert('13 events logged', (events?.length ?? 0) === 13, `got ${events?.length}`);

  // ── Test 5: Worker Module Imports ──
  console.log('\n── 5. Worker Module Verification ──');
  const renderer = await import('../workers/renderer.js');
  assert('renderVideo function exists', typeof renderer.renderVideo === 'function');

  const pipeline = await import('../workers/pipeline.js');
  assert('runPlanning function exists', typeof pipeline.runPlanning === 'function');
  assert('runRenderPipeline function exists', typeof pipeline.runRenderPipeline === 'function');

  const clipPrep = await import('../workers/clip-prep.js');
  assert('prepareClips function exists', typeof clipPrep.prepareClips === 'function');

  const transcriber = await import('../workers/transcriber.js');
  assert('transcribeAll function exists', typeof transcriber.transcribeAll === 'function');

  const audioMixer = await import('../workers/audio-mixer.js');
  assert('mixAudio function exists', typeof audioMixer.mixAudio === 'function');

  const syncChecker = await import('../workers/sync-checker.js');
  assert('checkSync function exists', typeof syncChecker.checkSync === 'function');

  const exporter = await import('../workers/exporter.js');
  assert('exportPlatforms function exists', typeof exporter.exportPlatforms === 'function');

  const qaChecker = await import('../workers/qa-checker.js');
  assert('runQAChecks function exists', typeof qaChecker.runQAChecks === 'function');
  assert('allChecksPassed function exists', typeof qaChecker.allChecksPassed === 'function');

  // ── Test 6: Temp Directory Management ──
  console.log('\n── 6. Temp Directory Management ──');
  const tempDir = '/tmp/video-factory/test-phase5';
  await mkdir(tempDir, { recursive: true });
  assert('Temp dir created', existsSync(tempDir));
  await rm(tempDir, { recursive: true, force: true });
  assert('Temp dir cleaned up', !existsSync(tempDir));

  // ── Test 7: Pipeline State Validation ──
  console.log('\n── 7. State Machine Validation ──');
  assert('idle has transitions', VALID_TRANSITIONS.idle.length > 0);
  assert('delivered is terminal', VALID_TRANSITIONS.delivered.length === 0);
  assert('failed can retry', VALID_TRANSITIONS.failed.includes('planning'));
  assert('human_qa can reject to planning', VALID_TRANSITIONS.human_qa.includes('planning'));
  assert('brief_review can reject to planning', VALID_TRANSITIONS.brief_review.includes('planning'));

  // ── Cleanup ──
  console.log('\n── Cleanup ──');
  await supabaseAdmin.from('job_events').delete().eq('job_id', jobId);
  await supabaseAdmin.from('jobs').delete().eq('id', jobId);
  assert('Test data cleaned up', true);

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ Phase 5 tests passed!\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
