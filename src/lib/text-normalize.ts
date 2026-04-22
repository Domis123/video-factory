/**
 * Naive text normalization for clustering near-duplicate free-form tags
 * coming out of the Gemini segment analyzer. Used by library-inventory-v2
 * to stop "glute bridge" / "glute-bridge" / "Glute Bridge" / "glute bridges"
 * from showing up as four separate identities in the Planner's inventory.
 *
 * We deliberately keep it simple — we cluster, not conjugate.
 *
 * File: src/lib/text-normalize.ts
 */

export function normalizeToken(s: string): string {
  // 1. lowercase + dehyphen + collapse whitespace + trim.
  const cleaned = s
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Strip trailing 's' for naive singularization, keeping words that end in
  //    'ss' (class, glass, loss), 'is' (analysis, basis), or 'us' (bus, virus).
  return cleaned.replace(/([a-z])s$/, (match, ch) => {
    const tail = cleaned.slice(-3);
    if (tail.endsWith('ss') || tail.endsWith('is') || tail.endsWith('us')) {
      return match;
    }
    return ch;
  });
}

export function normalizeAndCount(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of items) {
    if (!raw || typeof raw !== 'string') continue;
    const key = normalizeToken(raw);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
