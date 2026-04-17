const TREATMENT_FILTERS: Record<string, string> = {
  'warm-vibrant': 'saturate(1.2) contrast(1.05) brightness(1.02) sepia(0.08)',
  'cool-muted': 'saturate(0.85) contrast(1.02) brightness(0.98) hue-rotate(10deg)',
  'high-contrast': 'contrast(1.3) saturate(1.1) brightness(0.95)',
  'soft-pastel': 'saturate(0.7) contrast(0.9) brightness(1.1) sepia(0.05)',
  'moody-dark': 'contrast(1.15) brightness(0.85) saturate(0.9)',
  'natural': 'none',
  'golden-hour': 'sepia(0.15) saturate(1.15) brightness(1.05) contrast(1.02)',
  'clean-bright': 'brightness(1.1) contrast(1.05) saturate(1.05)',
};

export function getColorTreatmentFilter(treatment: string): string {
  return TREATMENT_FILTERS[treatment] ?? 'none';
}
