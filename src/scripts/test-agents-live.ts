/**
 * Test Phase 3: AI Agents (LIVE mode — calls Claude Sonnet API)
 * Runs all 3 agents with real API calls and validates output structure.
 */

import 'dotenv/config';
import type { BrandConfig } from '../types/database.js';
import { generateBrief } from '../agents/creative-director.js';
import { selectClips } from '../agents/asset-curator.js';
import { generateCopy } from '../agents/copywriter.js';
import { buildContextPacket } from '../agents/context-packet.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not set in .env — cannot run live test');
  process.exit(1);
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
      font_family: 'Inter',
      font_size: 48,
      font_weight: 800,
      text_color: '#FFFFFF',
      stroke_color: '#000000',
      stroke_width: 3,
      background: 'none',
      position: 'bottom-center',
      margin_bottom_px: 120,
      max_width_percent: 90,
      text_align: 'center',
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
  voice_guidelines: 'Warm, encouraging, fitness-positive. Avoid aggressive sales language.',
  hook_style_preference: ['pov', 'question', 'challenge'],
  content_pillars: ['pilates', 'flexibility', 'wellness', 'daily routine'],
  drive_input_folder_id: null,
  drive_output_folder_id: null,
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const ideaSeed = '3 pilates stretches you can do at your desk for better posture';

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

async function main() {
  console.log('\n🔴 Phase 3: AI Agent Tests (LIVE — Claude Sonnet API)\n');

  // ── Agent 1: Creative Director ──
  console.log('── Agent 1: Creative Director (calling Claude API...) ──');
  const brief = await generateBrief({ ideaSeed, brandConfig: mockBrand });
  console.log(`   Template: ${brief.template_id}, Duration: ${brief.total_duration_target}s, Segments: ${brief.segments.length}`);

  assert('Brief has brief_id', !!brief.brief_id);
  assert('Brief brand matches', brief.brand_id === 'nordpilates');
  assert('Brief has template_id', !!brief.template_id);
  assert('Brief has segments', brief.segments.length >= 2);
  assert('Has hook segment', brief.segments.some((s) => s.type === 'hook'));
  assert('Has CTA segment', brief.segments.some((s) => s.type === 'cta'));
  assert('Duration 30-60s', brief.total_duration_target >= 25 && brief.total_duration_target <= 65);
  assert('Segments have clip_requirements', brief.segments.every((s) => !!s.clip_requirements));
  assert('Segments have text_overlay', brief.segments.every((s) => !!s.text_overlay));
  assert('Has audio strategy', !!brief.audio?.strategy);

  // ── Agent 2: Asset Curator ──
  // Will fall back to mock since no assets in DB for nordpilates yet — that's fine
  console.log('\n── Agent 2: Asset Curator (calling Claude API...) ──');
  const clips = await selectClips({ brief });
  console.log(`   Clip selections: ${clips.clip_selections.length}`);

  assert('Clips reference brief', clips.brief_id === brief.brief_id);
  assert('Has clip selections', clips.clip_selections.length > 0);

  // ── Agent 3: Copywriter ──
  console.log('\n── Agent 3: Copywriter (calling Claude API...) ──');
  const copy = await generateCopy({ brief, brandConfig: mockBrand });
  console.log(`   Overlays: ${copy.overlays.length}, Hooks: ${copy.hook_variants.length}`);

  assert('Copy references brief', copy.brief_id === brief.brief_id);
  assert('Has overlays', copy.overlays.length > 0);
  assert('Has TikTok caption', !!copy.captions?.tiktok && copy.captions.tiktok.length > 0);
  assert('Has Instagram caption', !!copy.captions?.instagram && copy.captions.instagram.length > 0);
  assert('Has YouTube caption', !!copy.captions?.youtube && copy.captions.youtube.length > 0);
  assert('Has TikTok hashtags', (copy.hashtags?.tiktok?.length ?? 0) > 0);
  assert('Has Instagram hashtags', (copy.hashtags?.instagram?.length ?? 0) > 0);
  assert('Has hook variants', (copy.hook_variants?.length ?? 0) >= 2);
  assert('Hook variants have text + style', copy.hook_variants.every((h) => !!h.text && !!h.style));

  // ── Full Context Packet ──
  console.log('\n── Full Context Packet (all 3 agents → merge) ──');
  const packet = await buildContextPacket({ ideaSeed, brandConfig: mockBrand });
  console.log(`   Packet ID: ${packet.context_packet_id}`);

  assert('Packet has ID', !!packet.context_packet_id);
  assert('Packet has brief', !!packet.brief);
  assert('Packet has clips', !!packet.clips);
  assert('Packet has copy', !!packet.copy);
  assert('Packet has brand_config', packet.brand_config.brand_id === 'nordpilates');
  assert('Packet has created_at', !!packet.created_at);

  // Print sample output
  console.log('\n── Sample Creative Brief (from Claude) ──');
  console.log(`   Template: ${brief.template_id}`);
  console.log(`   Duration: ${brief.total_duration_target}s`);
  console.log(`   Hook: "${brief.segments.find((s) => s.type === 'hook')?.text_overlay.text}"`);
  console.log(`   CTA: "${brief.segments.find((s) => s.type === 'cta')?.text_overlay.text}"`);

  console.log('\n── Sample Copy (from Claude) ──');
  console.log(`   TikTok: ${copy.captions.tiktok.slice(0, 80)}...`);
  console.log(`   Hooks: ${copy.hook_variants.map((h) => `"${h.text}" (${h.style})`).join(', ')}`);

  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ Phase 3 agents working with Claude Sonnet API!\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
