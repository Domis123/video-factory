import { env } from '../config/env.js';
import { generateBriefPhase2 } from './creative-director.js';
import { generateBriefPhase3 } from './creative-director-phase3.js';
import type { BrandConfig, CreativeBrief, Phase3CreativeBrief } from '../types/database.js';

export type DispatchedBrief =
  | { phase: 'phase2'; brief: CreativeBrief }
  | { phase: 'phase3'; brief: Phase3CreativeBrief };

export interface DispatchInput {
  ideaSeed: string;
  brandConfig: BrandConfig;
}

/**
 * Flag-gated CD dispatcher. Reads ENABLE_PHASE_3_CD at call time.
 *
 * Returns a discriminated union so downstream callers must handle both
 * shapes explicitly — no implicit casting between Phase 2 and Phase 3 briefs.
 */
export async function generateBriefDispatched(input: DispatchInput): Promise<DispatchedBrief> {
  if (env.ENABLE_PHASE_3_CD) {
    console.log('[creative-director-dispatch] Using Phase 3 generator');
    const brief = await generateBriefPhase3(input);
    return { phase: 'phase3', brief };
  }

  console.log('[creative-director-dispatch] Using Phase 2 generator');
  const brief = await generateBriefPhase2(input);
  return { phase: 'phase2', brief };
}
