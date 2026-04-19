/**
 * Library Inventory — queries asset_segments to build a summary of available
 * exercise and hold content for a brand, grouped by body region.
 *
 * The Creative Director receives this summary so it designs videos using
 * only content that actually exists in the library.
 *
 * File: src/agents/library-inventory.ts
 */

import { supabaseAdmin } from '../config/supabase.js';

// ─── Body-part tags (category c from segment-analyzer.md) ───────────────────

const BODY_PARTS = new Set([
  'core', 'glutes', 'shoulders', 'legs', 'arms', 'hips', 'spine',
  'chest', 'hamstrings', 'quads', 'calves', 'back', 'abs', 'obliques',
  'neck', 'upper-body', 'lower-body', 'full-body',
  'triceps', 'hip-flexors', 'inner-thighs',
]);

// ─── Tags that are NOT exercise names ───────────────────────────────────────

const NON_EXERCISE_TAGS = new Set([
  // Body positions (category b)
  'hands-and-knees', 'supine', 'prone', 'standing', 'seated',
  'side-lying', 'kneeling', 'high-plank', 'forearm-plank',
  'all-fours', 'tabletop', 'reclined', 'inverted', 'elevated',
  // Camera framing (category d)
  'wide-shot', 'medium-shot', 'close-up', 'overhead', 'overhead-shot',
  'medium-wide-shot', 'low-angle', 'high-angle', 'back-view',
  'front-view', 'side-view', 'profile', 'three-quarter', 'bird-eye',
  'aerial', 'pov', 'tracking', 'pan', 'tilt',
  // Settings & locations (category e)
  'indoor', 'outdoor', 'beach', 'studio', 'home', 'kitchen',
  'gym', 'pool', 'bedroom', 'living-room', 'bathroom', 'garage',
  'home-studio', 'rooftop', 'balcony', 'canopy', 'patio', 'terrace',
  'backyard', 'garden', 'park', 'field', 'tropical', 'urban',
  'supermarket', 'store', 'office', 'hotel', 'spa',
  // Surfaces & ground
  'artificial-grass', 'grass', 'concrete', 'hardwood', 'carpet',
  'tile', 'sand', 'deck', 'dock',
  // Lighting
  'daylight', 'bright-light', 'natural-light', 'soft-light',
  'warm-light', 'artificial-light', 'dim-light', 'backlit',
  'golden-light', 'sunset-light', 'sunrise-light',
  // Side/limb (category h)
  'left-side', 'right-side', 'left-leg', 'right-leg', 'alternating',
  'bilateral', 'unilateral',
  // Movement phase/quality descriptors (NOT exercise names)
  'final-rep', 'first-rep', 'mid-rep', 'final-reps', 'static', 'flow',
  'dynamic', 'controlled', 'explosive', 'slow', 'fast', 'rhythmic',
  'pulsing', 'isometric', 'bodyweight', 'endurance', 'stability',
  'stillness', 'strength', 'breathing', 'meditation', 'mindfulness',
  'movement', 'posture', 'mobility', 'cardio', 'hold', 'stretch',
  'stretching', 'running', 'jogging', 'bright', 'center',
  // Body positions missed in first pass (category b)
  'quadruped', 'pike', 'cross-legged', 'semi-supine',
  // Generic activity labels (not specific exercise names)
  'pilates', 'yoga', 'barre', 'calisthenics',
  // Common objects & props
  'hands', 'person', 'mat', 'wall', 'foam-roller', 'chair', 'band',
  'block', 'pilates-ring', 'reformer', 'towel', 'tablet', 'phone',
  'mirror', 'step', 'bench', 'box', 'strap', 'ball', 'dumbbell',
  'kettlebell', 'barbell', 'resistance-band', 'yoga-block',
  'ankle-weights', 'wrist-weights', 'dumbbells', 'magic-circle',
  // Food/kitchen (misclassified segments)
  'plating-food', 'hand-reaching', 'fist-comparison', 'static-hand',
  'thumbs-up',
  // Generic descriptors
  'warm-up', 'cool-down', 'rest', 'pause', 'recovery',
  'demonstration', 'instruction', 'intro', 'outro',
  'balance', 'twisting', 'arms-crossed', 'goalpost-arms',
  'hand-clenches', 'dynamic-stretch',
]);

/** Tags starting with these prefixes are not exercise names */
const EXCLUDED_PREFIXES = [
  'phase:', 'left-', 'right-',
  // Limb/body-part compound prefixes
  'hands-', 'both-', 'legs-', 'single-', 'straight-',
  // Generic activity prefixes
  'mat-', 'pilates-', 'reformer-', 'yoga-',
  // Framing/position prefixes
  'forearm-', 'forearms-',
];

/** Patterns for non-exercise tags — appearance, clothing, colors, lighting, framing, quality modifiers */
const NON_EXERCISE_PATTERNS: RegExp[] = [
  // Appearance: hair, clothing, skin (category f)
  /^(blonde|brunette|black-hair|red-hair|auburn)/,
  /-(outfit|top|shorts|leggings|bra|activewear|sleeve|pants|shirt|set|dress|skirt|hoodie|jacket|sweater|tank|crop)$/,
  /^(tanned|light|dark)-(skin)/,
  /-(bracelet|ring|jewelry|necklace|watch|earring)$/,
  /-(color|colou?red)$/,
  // Color-prefixed tags (clothing colors, not exercise names)
  /^(white|black|pink|blue|red|green|grey|gray|olive|maroon|navy|purple|orange|yellow|beige|cream|gold|silver|teal|coral|burgundy|lavender|mint|peach|rust|salmon|tan|turquoise|ivory|rose|amber|bronze|copper|charcoal|khaki|light-blue|light-green|light-pink|dark-blue|dark-green|dark-grey|neon)-/,
  // Framing suffixes
  /-(shot|view|angle)$/,
  // Lighting suffixes
  /-(light|lighting|lit)$/,
  // Quality/tempo/form modifier suffixes
  /-(tempo|form|rhythm|focus|engagement|control|phase|finish)$/,
  // Position/posture suffixes (body positions, not exercise names)
  /-(position|posture|supported|elevated|extended|clasped)$/,
  // Static/hold compound descriptors
  /^(static|steady|controlled|consistent|strong|mindful)-/,
  // Breath compound descriptors
  /^breath-/,
  // Form/muscle compound descriptors
  /^(form|muscle|core|return)-[a-z]/, // e.g. form-demonstration, muscle-focus, core-engagement, return-phase
  // Equipment suffixes
  /-(weights|weight|machine)$/,
];

function isNonExercisePattern(tag: string): boolean {
  return NON_EXERCISE_PATTERNS.some(p => p.test(tag));
}

function isExerciseNameTag(tag: string): boolean {
  if (BODY_PARTS.has(tag)) return false;
  if (NON_EXERCISE_TAGS.has(tag)) return false;
  if (EXCLUDED_PREFIXES.some(p => tag.startsWith(p))) return false;
  if (isNonExercisePattern(tag)) return false;
  return true;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BodyRegionInfo {
  count: number;
  exercises: string[];
}

export interface LibraryInventory {
  totalExerciseSegments: number;
  totalHoldSegments: number;
  talkingHeadCount: number;
  bRollCount: number;
  bodyRegions: Record<string, BodyRegionInfo>;
  /** Human-readable summary to inject into the CD prompt */
  summary: string;
}

// ─── Main query ─────────────────────────────────────────────────────────────

export async function getLibraryInventory(brandId: string): Promise<LibraryInventory> {
  // 1. Fetch exercise + hold segments (the slots that matter for the pivot)
  const { data: exerciseData, error: exError } = await supabaseAdmin
    .from('asset_segments')
    .select('visual_tags, segment_type, quality_score')
    .eq('brand_id', brandId)
    .in('segment_type', ['exercise', 'hold'])
    .gte('quality_score', 5)
    .limit(1000);

  if (exError) throw new Error(`Library inventory query failed: ${exError.message}`);

  // 2. Quick counts for talking-head and b-roll (hook/CTA slot planning)
  const { count: talkingHeadCount } = await supabaseAdmin
    .from('asset_segments')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('segment_type', 'talking-head')
    .gte('quality_score', 5);

  const { count: bRollCount } = await supabaseAdmin
    .from('asset_segments')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('segment_type', 'b-roll')
    .gte('quality_score', 5);

  // 3. Aggregate by body region
  const segments = exerciseData || [];
  let exerciseCount = 0;
  let holdCount = 0;
  const regionMap: Record<string, { count: number; exercises: Set<string> }> = {};

  for (const seg of segments) {
    if (seg.segment_type === 'exercise') exerciseCount++;
    else holdCount++;

    const tags: string[] = seg.visual_tags || [];
    const bodyParts = tags.filter(t => BODY_PARTS.has(t));
    const exerciseNames = tags.filter(t => isExerciseNameTag(t));

    for (const bp of bodyParts) {
      if (!regionMap[bp]) regionMap[bp] = { count: 0, exercises: new Set() };
      regionMap[bp].count++;
      for (const ex of exerciseNames) {
        regionMap[bp].exercises.add(ex);
      }
    }
  }

  // 4. Build structured output
  const bodyRegions: Record<string, BodyRegionInfo> = {};
  for (const [bp, info] of Object.entries(regionMap)) {
    bodyRegions[bp] = {
      count: info.count,
      exercises: [...info.exercises].sort(),
    };
  }

  // 5. Build human-readable summary for the CD prompt
  const summary = buildSummary({
    exerciseCount,
    holdCount,
    talkingHeadCount: talkingHeadCount ?? 0,
    bRollCount: bRollCount ?? 0,
    bodyRegions,
  });

  return {
    totalExerciseSegments: exerciseCount,
    totalHoldSegments: holdCount,
    talkingHeadCount: talkingHeadCount ?? 0,
    bRollCount: bRollCount ?? 0,
    bodyRegions,
    summary,
  };
}

// ─── Summary builder ────────────────────────────────────────────────────────

function buildSummary(data: {
  exerciseCount: number;
  holdCount: number;
  talkingHeadCount: number;
  bRollCount: number;
  bodyRegions: Record<string, BodyRegionInfo>;
}): string {
  const lines: string[] = [];

  lines.push('=== LIBRARY INVENTORY ===');
  lines.push(`Exercise clips: ${data.exerciseCount} | Hold clips: ${data.holdCount} | Talking-head: ${data.talkingHeadCount} | B-roll: ${data.bRollCount}`);
  lines.push('');

  if (data.talkingHeadCount < 10) {
    lines.push(`⚠ Talking-head clips are scarce (${data.talkingHeadCount}). Avoid using talking-head in multiple slots — prefer b-roll for CTA if hook already uses talking-head.`);
    lines.push('');
  }

  lines.push('Body regions (sorted by availability):');

  const sorted = Object.entries(data.bodyRegions)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [region, info] of sorted) {
    const exampleExercises = info.exercises.slice(0, 6).join(', ');
    const suffix = info.exercises.length > 6 ? ', ...' : '';
    const exLine = exampleExercises ? ` → ${exampleExercises}${suffix}` : '';
    lines.push(`  ${region}: ${info.count} clips${exLine}`);
  }

  lines.push('');
  lines.push('Design your video using ONLY body regions and movement styles listed above.');
  lines.push('Do NOT invent exercise names — describe movements visually in aesthetic_guidance.');

  return lines.join('\n');
}
