export const FORM_ID_VALUES = [
  'targeted_microtutorial',
  'fast_cut_montage',
  'cinematic_slow_cinema',
  'day_in_the_life',
  'routine_sequence',
  'myth_buster',
  'before_vs_better',
  'single_exercise_deep_dive',
  'running_joke_meme_remix',
  'reaction',
  'progress_montage',
  'beginner_follow_along',
  'hook_rev_tip',
  'aesthetic_ambient',
  'teacher_cue_drop',
  'equipment_prop_spotlight',
] as const;

export type FormId = (typeof FORM_ID_VALUES)[number];

// P6 (Voice-Over-Led) reserved for W10 audio generation workstream.
// Do NOT add until W10 ships per docs/w2-content-form-taxonomy.md.
export const POSTURE_VALUES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;

export type AestheticPosture = (typeof POSTURE_VALUES)[number];
