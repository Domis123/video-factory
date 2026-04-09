import {
  type VideoType,
  VIDEO_TYPE_CONFIGS,
  getAllowedVideoTypes,
} from '../types/video-types.js';

/** Keywords that hint toward specific video types */
const TYPE_SIGNALS: Record<VideoType, string[]> = {
  'workout-demo': [
    'workout', 'exercise', 'stretch', 'yoga', 'pilates', 'fitness',
    'squat', 'plank', 'push-up', 'routine', 'rep', 'set', 'burn',
    'training', 'movement', 'cardio', 'hiit', 'core', 'glute',
  ],
  'recipe-walkthrough': [
    'recipe', 'cook', 'meal', 'prep', 'ingredient', 'kitchen',
    'bake', 'food', 'dish', 'snack', 'breakfast', 'lunch', 'dinner',
    'protein', 'chicken', 'steak', 'salad', 'smoothie', 'bowl',
  ],
  'tips-listicle': [
    'tip', 'hack', 'trick', 'secret', 'mistake', 'rule', 'way',
    'thing', 'reason', 'step', 'how to', 'guide', 'must-know',
    'beginner', 'avoid', 'stop doing', 'start doing', 'never',
  ],
  'transformation': [
    'transformation', 'before', 'after', 'result', 'journey',
    'progress', 'glow-up', 'change', 'weight loss', 'lost',
    'gained', 'month', 'week', 'day challenge', 'finally',
  ],
};

/**
 * Select the best video type for a brand + idea seed.
 *
 * Strategy:
 * 1. Get allowed types for the brand
 * 2. Score each allowed type by keyword matches in the idea seed
 * 3. Return highest-scoring type (ties broken by order in allowed list)
 * 4. If no keywords match, return the first allowed type as default
 */
export function selectVideoType(brandId: string, ideaSeed: string): VideoType {
  const allowed = getAllowedVideoTypes(brandId);
  if (allowed.length === 1) return allowed[0];

  const seedLower = ideaSeed.toLowerCase();
  let bestType = allowed[0];
  let bestScore = 0;

  for (const vt of allowed) {
    const signals = TYPE_SIGNALS[vt];
    let score = 0;
    for (const keyword of signals) {
      if (seedLower.includes(keyword)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = vt;
    }
  }

  return bestType;
}

/** Get the full config for a video type */
export function getVideoTypeConfig(videoType: VideoType) {
  return VIDEO_TYPE_CONFIGS[videoType];
}
