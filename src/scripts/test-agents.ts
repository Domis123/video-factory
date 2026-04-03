/**
 * Test Phase 3: AI Agents (mock mode)
 * Runs all 3 agents and assembles a Context Packet without calling Claude API.
 */

import type { BrandConfig } from '../types/database.js';
import { generateMockBrief } from '../agents/creative-director.js';
import { selectMockClips } from '../agents/asset-curator.js';
import { generateMockCopy } from '../agents/copywriter.js';
import { buildContextPacket } from '../agents/context-packet.js';

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
  console.log('\n🧪 Phase 3: AI Agent Tests (Mock Mode)\n');

  // Test 1: Creative Director
  console.log('── Agent 1: Creative Director ──');
  const brief = generateMockBrief({ ideaSeed, brandConfig: mockBrand });
  assert('Brief has brief_id', !!brief.brief_id);
  assert('Brief brand matches', brief.brand_id === 'nordpilates');
  assert('Brief has template_id', !!brief.template_id);
  assert('Brief has 3 segments', brief.segments.length === 3);
  assert('First segment is hook', brief.segments[0].type === 'hook');
  assert('Last segment is CTA', brief.segments[2].type === 'cta');
  assert('Duration target is 30-60s', brief.total_duration_target >= 30 && brief.total_duration_target <= 60);
  assert('Body has sub_segments', (brief.segments[1].sub_segments?.length ?? 0) > 0);

  // Test 2: Asset Curator
  console.log('\n── Agent 2: Asset Curator ──');
  const clips = selectMockClips({ brief });
  assert('Clips reference correct brief', clips.brief_id === brief.brief_id);
  assert('Clips cover all segments', clips.clip_selections.length === brief.segments.length);
  assert('Hook segment has single clip', !!clips.clip_selections[0].r2_key);
  assert('Body segment has multi-clip', (clips.clip_selections[1].clips?.length ?? 0) > 0);
  assert('All r2_keys start with assets/', clips.clip_selections.every(
    (s) => s.r2_key?.startsWith('assets/') || s.clips?.every((c) => c.r2_key.startsWith('assets/'))
  ));

  // Test 3: Copywriter
  console.log('\n── Agent 3: Copywriter ──');
  const copy = generateMockCopy({ brief, brandConfig: mockBrand });
  assert('Copy references correct brief', copy.brief_id === brief.brief_id);
  assert('Has overlays for all segments', copy.overlays.length === brief.segments.length);
  assert('Has TikTok caption', copy.captions.tiktok.length > 0);
  assert('Has Instagram caption', copy.captions.instagram.length > 0);
  assert('Has YouTube caption', copy.captions.youtube.length > 0);
  assert('Has 5+ TikTok hashtags', copy.hashtags.tiktok.length >= 5);
  assert('Has 3 hook variants', copy.hook_variants.length === 3);
  assert('Hook variants have style labels', copy.hook_variants.every((h) => !!h.style));

  // Test 4: Context Packet assembly
  console.log('\n── Context Packet Assembly ──');
  const packet = await buildContextPacket({ ideaSeed, brandConfig: mockBrand });
  assert('Packet has ID', !!packet.context_packet_id);
  assert('Packet has brief', !!packet.brief);
  assert('Packet has clips', !!packet.clips);
  assert('Packet has copy', !!packet.copy);
  assert('Packet has brand_config', packet.brand_config.brand_id === 'nordpilates');
  assert('Packet has created_at', !!packet.created_at);
  assert('Brief/clips/copy brief_ids match',
    packet.brief.brief_id === packet.clips.brief_id &&
    packet.brief.brief_id === packet.copy.brief_id
  );

  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ Phase 3 agents working in mock mode!\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
