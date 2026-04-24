/**
 * W8 render-prep — pre-enqueue Remotion null-safety guard.
 *
 * Part B's CopyPackage carries `voiceover_script: null` today (W7 placeholder;
 * W10 widens to `string | null`). Pre-work verification in
 * `docs/smoke-runs/w8-phase35-dispatch-notes.md` § 4 confirmed that Remotion
 * does not currently read `voiceover_script` anywhere. That means the guard
 * is trivially satisfied — null is safe to pass through — but it ships
 * defensively so that:
 *
 *   (a) When W10 wires voice generation and Remotion starts reading the
 *       field, this guard is the single place to adjust. We don't have to
 *       hunt across renderer.ts to find the null-handling gap.
 *   (b) Tier 3 Gate A synthetic case #4 can point a test at
 *       `prepareContextForRender` and assert the null-in → null-out
 *       contract independent of any downstream Remotion wiring.
 *   (c) If W10 lands a behavior change (say, Remotion errors on null and
 *       the fix is to omit the field entirely), only this file changes;
 *       the orchestrator contract stays identical.
 *
 * Current implementation is pass-through with an explicit branch so the
 * intent is legible, not an accidental "we didn't handle null."
 *
 * File: src/orchestrator/render-prep.ts
 */

import type { CopyPackage } from '../types/copywriter-output.js';

/**
 * Minimum shape of a packet this guard operates on. The orchestrator's
 * context_packet_v2 shape is still being finalized in commit 10; typing
 * this generically on the `copy` field lets commit 10 pass whatever it
 * assembles without a circular type dependency.
 */
export interface PreparableContext {
  copy: CopyPackage;
  // Everything else on the packet passes through unchanged.
  [key: string]: unknown;
}

export interface RenderPrepResult<T extends PreparableContext> {
  /** The same packet shape with voiceover_script handled per pre-work decision. */
  context: T;
  /** Human-readable summary of what (if anything) was transformed. */
  notes: string;
}

/**
 * Pre-enqueue sanity pass on a Part B context packet bound for Remotion.
 *
 * Today: pass-through. Null `voiceover_script` is safe because Remotion
 * does not read the field (pre-work verified). We still branch on it so
 * the intent is explicit and W10 has an obvious modification site.
 */
export function prepareContextForRender<T extends PreparableContext>(
  context: T,
): RenderPrepResult<T> {
  // Typed as `unknown` here because the Zod schema pins `voiceover_script`
  // to `z.null()` today, but W10 will widen to `z.string().nullable()`. This
  // guard ships both branches pre-emptively so W10 doesn't also have to
  // relocate the null/string handling.
  const vo = context.copy.voiceover_script as unknown;

  // Pre-work verification (w8-phase35-dispatch-notes.md § 4):
  //   Remotion never reads `voiceover_script` today. null is safe.
  // When W10 wires voice generation and Remotion reads the field, adjust
  // the guard body below — the caller contract (same packet in / packet
  // out) stays identical.
  if (vo === null) {
    return {
      context,
      notes:
        'voiceover_script=null — pass-through (Remotion does not read the field pre-W10)',
    };
  }

  // String branch is unreachable until W10 widens the Zod schema, but
  // shipping it now means W10 only needs to decide the null-vs-omit
  // policy, not also find the right place to enforce it.
  if (typeof vo === 'string') {
    const trimmed = vo.trim();
    if (trimmed === '') {
      return {
        context: {
          ...context,
          copy: { ...context.copy, voiceover_script: null as unknown as null },
        } as T,
        notes:
          'voiceover_script was empty/whitespace — normalized to null for render-safety',
      };
    }
    return {
      context,
      notes: `voiceover_script=<${trimmed.length} chars> — pass-through (pre-W10 schema type z.null, reachable only post-W10)`,
    };
  }

  // Neither null nor string — schema-level corruption. Fail loud per Rule 38.
  throw new Error(
    `[render-prep] voiceover_script has unexpected type ${typeof vo}; expected null or string`,
  );
}
