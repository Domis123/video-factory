// ── Video Type System ──
// Defines 4 video types with pacing profiles, energy curves, and segment structures.
// Everything downstream (transitions, music selection, clip sequencing) is parameterized by video type.

export type VideoType = 'workout-demo' | 'recipe-walkthrough' | 'tips-listicle' | 'transformation';

export interface PacingProfile {
  /** Minimum clip hold duration in seconds */
  min_clip_duration: number;
  /** Maximum clip hold duration in seconds */
  max_clip_duration: number;
  /** Cuts per second (approximate target) */
  cuts_per_second: number;
  /** Overall feel descriptor */
  feel: 'fast' | 'medium' | 'slow' | 'building';
}

export interface SegmentTemplate {
  type: 'hook' | 'body' | 'cta';
  /** Label for this segment (e.g., "exercise-1", "ingredient-list", "before") */
  label: string;
  /** Target duration range [min, max] in seconds */
  duration_range: [number, number];
  /** Energy level 1-10 for this segment position */
  energy: number;
  /** Preferred content types for clip matching */
  preferred_content_types: string[];
  /** Whether speech is typically expected */
  expects_speech: boolean;
}

export interface TransitionPreference {
  /** Preferred transition types for this video type */
  types: string[];
  /** Whether transitions should sync to beat when music is available */
  beat_sync: boolean;
}

export interface VideoTypeConfig {
  type: VideoType;
  /** Human-readable name */
  name: string;
  /** One-line description for the Creative Director */
  description: string;
  /** Duration range [min, max] in seconds */
  duration_range: [number, number];
  /** Pacing profile */
  pacing: PacingProfile;
  /** Energy curve — per-segment energy levels (1-10) describing the arc */
  energy_curve: number[];
  /** Music energy range [min, max] on 1-10 scale */
  music_energy_range: [number, number];
  /** Segment structure template */
  segments: SegmentTemplate[];
  /** Transition preferences */
  transitions: TransitionPreference;
  /** Audio strategy default */
  audio_strategy: 'ugc-primary' | 'music-primary';
}

export const VIDEO_TYPE_CONFIGS: Record<VideoType, VideoTypeConfig> = {
  'workout-demo': {
    type: 'workout-demo',
    name: 'Workout Demo',
    description: 'High-energy exercise sequence with fast cuts. Hook → 3-5 exercise clips → CTA.',
    duration_range: [30, 45],
    pacing: {
      min_clip_duration: 1,
      max_clip_duration: 3,
      cuts_per_second: 0.5,
      feel: 'fast',
    },
    energy_curve: [8, 9, 9, 8, 7],
    music_energy_range: [7, 9],
    segments: [
      {
        type: 'hook',
        label: 'hook',
        duration_range: [2, 3],
        energy: 8,
        preferred_content_types: ['workout', 'lifestyle', 'talking-head'],
        expects_speech: false,
      },
      {
        type: 'body',
        label: 'exercise-1',
        duration_range: [5, 8],
        energy: 9,
        preferred_content_types: ['workout', 'product-demo'],
        expects_speech: false,
      },
      {
        type: 'body',
        label: 'exercise-2',
        duration_range: [5, 8],
        energy: 9,
        preferred_content_types: ['workout', 'product-demo'],
        expects_speech: false,
      },
      {
        type: 'body',
        label: 'exercise-3',
        duration_range: [5, 8],
        energy: 8,
        preferred_content_types: ['workout', 'product-demo'],
        expects_speech: false,
      },
      {
        type: 'cta',
        label: 'cta',
        duration_range: [3, 5],
        energy: 7,
        preferred_content_types: ['lifestyle', 'talking-head'],
        expects_speech: true,
      },
    ],
    transitions: {
      types: ['cut', 'zoom', 'slide-left'],
      beat_sync: true,
    },
    audio_strategy: 'music-primary',
  },

  'recipe-walkthrough': {
    type: 'recipe-walkthrough',
    name: 'Recipe Walkthrough',
    description: 'Step-by-step cooking/recipe with medium holds. Hook → Ingredients → 2-4 Steps → Final reveal → CTA.',
    duration_range: [40, 60],
    pacing: {
      min_clip_duration: 3,
      max_clip_duration: 6,
      cuts_per_second: 0.25,
      feel: 'medium',
    },
    energy_curve: [5, 4, 5, 6, 7, 6],
    music_energy_range: [4, 6],
    segments: [
      {
        type: 'hook',
        label: 'hook',
        duration_range: [2, 4],
        energy: 5,
        preferred_content_types: ['cooking', 'lifestyle', 'talking-head'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'ingredients',
        duration_range: [4, 8],
        energy: 4,
        preferred_content_types: ['cooking', 'product-demo', 'b-roll'],
        expects_speech: false,
      },
      {
        type: 'body',
        label: 'step-1',
        duration_range: [6, 10],
        energy: 5,
        preferred_content_types: ['cooking', 'product-demo'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'step-2',
        duration_range: [6, 10],
        energy: 6,
        preferred_content_types: ['cooking', 'product-demo'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'final-reveal',
        duration_range: [4, 6],
        energy: 7,
        preferred_content_types: ['cooking', 'product-demo', 'b-roll'],
        expects_speech: false,
      },
      {
        type: 'cta',
        label: 'cta',
        duration_range: [3, 5],
        energy: 6,
        preferred_content_types: ['lifestyle', 'talking-head'],
        expects_speech: true,
      },
    ],
    transitions: {
      types: ['fade', 'slide-up', 'wipe'],
      beat_sync: false,
    },
    audio_strategy: 'ugc-primary',
  },

  'tips-listicle': {
    type: 'tips-listicle',
    name: 'Tips Listicle',
    description: 'Numbered tips with rhythmic pacing. Hook → 3-5 numbered tips → CTA. Works for all brands.',
    duration_range: [30, 45],
    pacing: {
      min_clip_duration: 2,
      max_clip_duration: 4,
      cuts_per_second: 0.35,
      feel: 'medium',
    },
    energy_curve: [7, 6, 6, 7, 7, 6],
    music_energy_range: [5, 7],
    segments: [
      {
        type: 'hook',
        label: 'hook',
        duration_range: [2, 3],
        energy: 7,
        preferred_content_types: ['talking-head', 'lifestyle'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'tip-1',
        duration_range: [5, 8],
        energy: 6,
        preferred_content_types: ['product-demo', 'lifestyle', 'b-roll'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'tip-2',
        duration_range: [5, 8],
        energy: 6,
        preferred_content_types: ['product-demo', 'lifestyle', 'b-roll'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'tip-3',
        duration_range: [5, 8],
        energy: 7,
        preferred_content_types: ['product-demo', 'lifestyle', 'b-roll'],
        expects_speech: true,
      },
      {
        type: 'cta',
        label: 'cta',
        duration_range: [3, 5],
        energy: 6,
        preferred_content_types: ['lifestyle', 'talking-head'],
        expects_speech: true,
      },
    ],
    transitions: {
      types: ['cut', 'slide-left', 'fade'],
      beat_sync: true,
    },
    audio_strategy: 'ugc-primary',
  },

  'transformation': {
    type: 'transformation',
    name: 'Transformation',
    description: 'Dramatic before/after reveal with slow build. Hook → Before footage → After reveal → CTA.',
    duration_range: [25, 40],
    pacing: {
      min_clip_duration: 2,
      max_clip_duration: 5,
      cuts_per_second: 0.2,
      feel: 'building',
    },
    energy_curve: [3, 4, 5, 8, 7],
    music_energy_range: [3, 8],
    segments: [
      {
        type: 'hook',
        label: 'hook',
        duration_range: [2, 4],
        energy: 3,
        preferred_content_types: ['before-after', 'talking-head', 'lifestyle'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'before',
        duration_range: [6, 10],
        energy: 4,
        preferred_content_types: ['before-after', 'lifestyle', 'b-roll'],
        expects_speech: true,
      },
      {
        type: 'body',
        label: 'journey',
        duration_range: [5, 8],
        energy: 5,
        preferred_content_types: ['workout', 'lifestyle', 'product-demo'],
        expects_speech: false,
      },
      {
        type: 'body',
        label: 'after-reveal',
        duration_range: [4, 6],
        energy: 8,
        preferred_content_types: ['before-after', 'lifestyle'],
        expects_speech: false,
      },
      {
        type: 'cta',
        label: 'cta',
        duration_range: [3, 5],
        energy: 7,
        preferred_content_types: ['lifestyle', 'talking-head'],
        expects_speech: true,
      },
    ],
    transitions: {
      types: ['wipe', 'zoom', 'fade'],
      beat_sync: true,
    },
    audio_strategy: 'music-primary',
  },
};

/** Brand → allowed video types mapping */
export const BRAND_VIDEO_TYPES: Record<string, VideoType[]> = {
  nordpilates: ['workout-demo', 'tips-listicle', 'transformation'],
  highdiet: ['workout-demo', 'tips-listicle', 'transformation'],
  ketoway: ['recipe-walkthrough', 'tips-listicle'],
  carnimeat: ['recipe-walkthrough', 'tips-listicle'],
  nodiet: ['tips-listicle', 'transformation'],
};

/** Default video types for brands not in the map */
export const DEFAULT_VIDEO_TYPES: VideoType[] = ['tips-listicle'];

/** Get allowed video types for a brand */
export function getAllowedVideoTypes(brandId: string): VideoType[] {
  return BRAND_VIDEO_TYPES[brandId] ?? DEFAULT_VIDEO_TYPES;
}
