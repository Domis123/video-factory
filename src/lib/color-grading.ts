/**
 * Color grading pipeline for clip preparation.
 *
 * Three-step approach:
 * 1. Auto-level — normalize histogram to consistent baseline
 * 2. Brand LUT — apply .cube LUT file if brand has one in R2
 * 3. Preset fallback — if no LUT, apply a named preset (warm-vibrant, cool-clean, neutral, high-contrast)
 *
 * Uses Phase 1 clip metadata (avg_brightness) to adjust auto-leveling per clip.
 */

export type ColorPreset = 'warm-vibrant' | 'cool-clean' | 'neutral' | 'high-contrast';

export interface GradingConfig {
  /** Brand's color grade preset (null = neutral) */
  preset: ColorPreset | null;
  /** Local path to downloaded .cube LUT file (null = no LUT) */
  lutPath: string | null;
  /** Clip's average brightness from ingestion (0-255, null = unknown) */
  avgBrightness: number | null;
}

/**
 * Build an FFmpeg video filter string for color grading.
 * Returns the filter chain to append to -vf.
 */
export function buildGradingFilter(config: GradingConfig): string {
  const filters: string[] = [];

  // Step 1: Auto-level — normalize color histogram
  // Adjust input range based on clip brightness to avoid blowing out bright clips
  // or crushing dark ones
  const { riMin, riMax } = getAutoLevelRange(config.avgBrightness);
  filters.push(
    `colorlevels=rimin=${riMin}:gimin=${riMin}:bimin=${riMin}:rimax=${riMax}:gimax=${riMax}:bimax=${riMax}`,
  );

  // Step 2: Apply brand LUT if available
  if (config.lutPath) {
    filters.push(`lut3d=${config.lutPath}`);
    return filters.join(',');
  }

  // Step 3: Preset fallback
  const preset = config.preset ?? 'neutral';
  const presetFilter = PRESET_FILTERS[preset];
  if (presetFilter) {
    filters.push(presetFilter);
  }

  return filters.join(',');
}

/**
 * Adjust auto-level input ranges based on clip brightness.
 * Bright clips (>170) get less aggressive lifting.
 * Dark clips (<80) get less aggressive crushing.
 */
function getAutoLevelRange(avgBrightness: number | null): { riMin: number; riMax: number } {
  if (avgBrightness === null) {
    return { riMin: 0.04, riMax: 0.96 }; // standard range
  }

  if (avgBrightness > 170) {
    // Bright clip — be gentle, avoid blowout
    return { riMin: 0.02, riMax: 0.98 };
  }
  if (avgBrightness < 80) {
    // Dark clip — be gentle, preserve shadows
    return { riMin: 0.02, riMax: 0.94 };
  }

  // Normal brightness — standard auto-level
  return { riMin: 0.04, riMax: 0.96 };
}

/**
 * Color preset FFmpeg filter strings.
 * Each creates a distinct visual feel via curves and saturation adjustments.
 */
const PRESET_FILTERS: Record<ColorPreset, string> = {
  'warm-vibrant':
    // Warm tones + boosted saturation
    'colortemperature=temperature=6800,eq=saturation=1.15:contrast=1.05',

  'cool-clean':
    // Cool tones + slight desaturation for clean look
    'colortemperature=temperature=5200,eq=saturation=0.92:contrast=1.08:brightness=0.02',

  'neutral':
    // Minimal intervention — just slight contrast boost
    'eq=contrast=1.03:saturation=1.02',

  'high-contrast':
    // Strong contrast + vivid colors
    'eq=contrast=1.20:saturation=1.10:brightness=-0.02',
};
