/**
 * Quality Upgrade Test — validates all new Phase 0-7 modules.
 * Run: npx tsx src/scripts/test-quality-upgrade.ts
 */

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
  console.log('\n🧪 Quality Upgrade Tests\n');

  // ── Phase 0: Video Type System ──
  console.log('── Phase 0: Video Type System ──');
  const { VIDEO_TYPE_CONFIGS, getAllowedVideoTypes, BRAND_VIDEO_TYPES } = await import('../types/video-types.js');
  const { selectVideoType, getVideoTypeConfig } = await import('../lib/video-type-selector.js');

  assert('4 video types defined', Object.keys(VIDEO_TYPE_CONFIGS).length === 4);
  assert('workout-demo has 5 segments', VIDEO_TYPE_CONFIGS['workout-demo'].segments.length === 5);
  assert('recipe-walkthrough has 6 segments', VIDEO_TYPE_CONFIGS['recipe-walkthrough'].segments.length === 6);
  assert('tips-listicle has 5 segments', VIDEO_TYPE_CONFIGS['tips-listicle'].segments.length === 5);
  assert('transformation has 5 segments', VIDEO_TYPE_CONFIGS['transformation'].segments.length === 5);

  assert('nordpilates allows workout-demo', getAllowedVideoTypes('nordpilates').includes('workout-demo'));
  assert('ketoway allows recipe-walkthrough', getAllowedVideoTypes('ketoway').includes('recipe-walkthrough'));
  assert('unknown brand defaults to tips-listicle', getAllowedVideoTypes('unknown-brand')[0] === 'tips-listicle');

  assert('Stretch idea → workout-demo', selectVideoType('nordpilates', '5 morning stretches for flexibility') === 'workout-demo');
  assert('Recipe idea → recipe-walkthrough', selectVideoType('ketoway', 'Easy keto chicken meal prep recipe') === 'recipe-walkthrough');
  assert('Tips idea → tips-listicle', selectVideoType('nodiet', '3 mistakes people make with dieting') === 'tips-listicle');
  assert('Before/after → transformation', selectVideoType('nordpilates', 'My 30 day transformation before and after results') === 'transformation');

  const vtConfig = getVideoTypeConfig('workout-demo');
  assert('Config has pacing', vtConfig.pacing.feel === 'fast');
  assert('Config has energy curve', vtConfig.energy_curve.length > 0);
  assert('Config has music range', vtConfig.music_energy_range[0] === 7);

  // ── Phase 2: Beat Detector ──
  console.log('\n── Phase 2: Beat Detector ──');
  const { snapToNearestBeat, snapFrameToNearestBeat } = await import('../lib/beat-detector.js');
  const mockBeatMap = {
    tempo_bpm: 120,
    first_beat_offset: 0,
    beat_positions: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    duration: 60,
  };

  assert('Snap 0.3s → 0.5s (nearest beat)', snapToNearestBeat(0.3, mockBeatMap) === 0.5);
  assert('Snap 0.1s → 0.0s (nearest beat)', snapToNearestBeat(0.1, mockBeatMap) === 0);
  assert('Snap 1.2s → 1.0s (nearest beat)', snapToNearestBeat(1.2, mockBeatMap) === 1.0);
  assert('Snap null beat map returns original', snapToNearestBeat(0.3, null) === 0.3);
  assert('Frame snap at 30fps', snapFrameToNearestBeat(10, 30, mockBeatMap) === 15); // 10/30=0.33s → 0.5s → frame 15

  // ── Phase 5: Color Grading ──
  console.log('\n── Phase 5: Color Grading ──');
  const { buildGradingFilter } = await import('../lib/color-grading.js');

  const neutralFilter = buildGradingFilter({ preset: 'neutral', lutPath: null, avgBrightness: null });
  assert('Neutral has auto-level', neutralFilter.includes('colorlevels'));
  assert('Neutral has contrast', neutralFilter.includes('eq=contrast'));

  const warmFilter = buildGradingFilter({ preset: 'warm-vibrant', lutPath: null, avgBrightness: 128 });
  assert('Warm-vibrant has colortemperature', warmFilter.includes('colortemperature'));
  assert('Warm-vibrant has saturation boost', warmFilter.includes('saturation=1.15'));

  const lutFilter = buildGradingFilter({ preset: 'warm-vibrant', lutPath: '/tmp/brand.cube', avgBrightness: 128 });
  assert('LUT overrides preset', lutFilter.includes('lut3d=/tmp/brand.cube'));
  assert('LUT filter has no preset eq', !lutFilter.includes('colortemperature'));

  const brightFilter = buildGradingFilter({ preset: 'neutral', lutPath: null, avgBrightness: 200 });
  assert('Bright clip gets gentle auto-level', brightFilter.includes('rimin=0.02'));

  const darkFilter = buildGradingFilter({ preset: 'neutral', lutPath: null, avgBrightness: 50 });
  assert('Dark clip gets gentle auto-level', darkFilter.includes('rimax=0.94'));

  // ── Phase 7: Template Config Builder ──
  console.log('\n── Phase 7: Template Config Builder ──');
  const { buildTemplateConfig } = await import('../lib/template-config-builder.js');
  // BriefSegment type used inline below

  const mockSegments = [
    { segment_id: 1, type: 'hook' as const, duration_target: 3, energy_level: 8, pacing: 'fast' as const, clip_requirements: { content_type: ['lifestyle'], mood: 'energetic' }, text_overlay: { text: 'test', style: 'bold', position: 'center' } },
    { segment_id: 2, type: 'body' as const, duration_target: 10, energy_level: 5, pacing: 'medium' as const, clip_requirements: { content_type: ['lifestyle'], mood: 'calm' }, text_overlay: { text: 'test', style: 'subtitle', position: 'bottom' } },
    { segment_id: 3, type: 'cta' as const, duration_target: 5, energy_level: 7, pacing: 'medium' as const, clip_requirements: { content_type: ['lifestyle'], mood: 'uplifting' }, text_overlay: { text: 'test', style: 'cta', position: 'center' } },
  ];

  const config = buildTemplateConfig(mockSegments, null);
  assert('Config has 3 segment configs', config.segments.length === 3);
  assert('High energy → shorter transition', config.segments[0].transition_frames < config.segments[1].transition_frames);
  assert('Fast pacing → short hold', config.segments[0].clip_hold_duration === 1.5);
  assert('Medium pacing → medium hold', config.segments[1].clip_hold_duration === 3.0);
  assert('Global speed > 1 for energetic', config.global_animation_speed > 1.0);
  assert('No beat sync without beat map', config.beat_sync_active === false);

  const configWithBeats = buildTemplateConfig(mockSegments, mockBeatMap);
  assert('Beat sync active with beat map', configWithBeats.beat_sync_active === true);
  assert('Beat transition times populated', configWithBeats.segments[0].beat_transition_time !== null);

  // ── Module imports ──
  console.log('\n── Module Imports ──');
  const clipAnalysis = await import('../lib/clip-analysis.js');
  assert('clip-analysis exports analyzeClipMetadata', typeof clipAnalysis.analyzeClipMetadata === 'function');

  const beatDetector = await import('../lib/beat-detector.js');
  assert('beat-detector exports buildBeatMap', typeof beatDetector.buildBeatMap === 'function');

  const colorGrading = await import('../lib/color-grading.js');
  assert('color-grading exports buildGradingFilter', typeof colorGrading.buildGradingFilter === 'function');

  const musicSelector = await import('../lib/music-selector.js');
  assert('music-selector exports selectMusicTrack', typeof musicSelector.selectMusicTrack === 'function');

  const templateConfigBuilder = await import('../lib/template-config-builder.js');
  assert('template-config-builder exports buildTemplateConfig', typeof templateConfigBuilder.buildTemplateConfig === 'function');

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
  console.log('\n✅ All quality upgrade modules working!\n');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
