/**
 * LLM cost computation — converts SDK usage metadata into USD spend.
 *
 * Used by W3 Planner, W5 Visual Director, W6 Coherence Critic, W7 Copywriter
 * to attach `cost_usd` to their typed return values. The orchestrator
 * (`runPipelineV2`) sums per-agent `cost_usd` into `OrchestratorContext.
 * costAccumulator` and the shadow-writer persists the total to
 * `shadow_runs.part_b_cost_usd`.
 *
 * Pricing source: Google AI public list pricing for the Gemini 2.5/3.1 family
 * as of 2026-04-26. Pricing is hardcoded (not env-var) per W9.1 brief — the
 * cost telemetry only needs to be proportional / sum-traceable, not exact-to-
 * the-cent. The Gemini API is free for this project via company credits per
 * CLAUDE.md, so this number is for proportional load tracking + the Q5d
 * cutover signal, not a real billing line.
 *
 * Hard constraint per Architecture Rule 38 (loud throw, no silent-zero):
 * if the SDK returns a response without `usageMetadata`, or with both token
 * counts at 0, this helper throws `MissingUsageMetadataError`. Silent-zero
 * would recreate the exact bug being fixed (Pattern A — emit failure).
 *
 * Hard constraint per Architecture Rule 33 (pin model IDs): every model that
 * any Part-B agent dispatches against must have an entry in the pricing map.
 * Unknown model IDs throw `UnpricedModelError` — adding a new model requires
 * an explicit price entry in this file, not silent fallback.
 *
 * Anthropic Sonnet pricing is intentionally absent: a grep across `src/agents`
 * on 2026-04-26 confirmed Sonnet usage is limited to Phase 3.5 agents
 * (creative-director-phase3.ts, copywriter.ts, asset-curator.ts) — the four
 * Part-B agents this fix targets are Gemini-only.
 *
 * File: src/lib/llm-cost.ts
 */

export interface UsageBreakdown {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

interface ModelPricing {
  input_per_mtok_usd: number;
  output_per_mtok_usd: number;
}

const GEMINI_PRICING: Record<string, ModelPricing> = {
  'gemini-3.1-pro-preview': { input_per_mtok_usd: 1.25, output_per_mtok_usd: 5.0 },
  'gemini-2.5-pro': { input_per_mtok_usd: 1.25, output_per_mtok_usd: 5.0 },
  'gemini-2.5-flash': { input_per_mtok_usd: 0.075, output_per_mtok_usd: 0.3 },
};

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseLike {
  usageMetadata?: GeminiUsageMetadata;
}

export class MissingUsageMetadataError extends Error {
  readonly model: string;
  constructor(model: string, detail: string) {
    super(
      `[llm-cost] Gemini response missing usageMetadata for model=${model}: ${detail}. ` +
        `Per Rule 38, refusing to silent-zero — fix the call site or the SDK plumbing.`,
    );
    this.name = 'MissingUsageMetadataError';
    this.model = model;
  }
}

export class UnpricedModelError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(
      `[llm-cost] No pricing entry for model "${model}". ` +
        `Per Rule 33, every pinned model must have an explicit price entry. ` +
        `Add the model to GEMINI_PRICING in src/lib/llm-cost.ts.`,
    );
    this.name = 'UnpricedModelError';
    this.model = model;
  }
}

/**
 * Compute USD spend from a Gemini `generateContent` response.
 *
 * @param model Pinned model ID (e.g. `gemini-3.1-pro-preview`). Must be a
 *              member of GEMINI_PRICING.
 * @param response The raw response object from `ai.models.generateContent(...)`.
 *              Must carry `usageMetadata.{promptTokenCount,candidatesTokenCount}`.
 *
 * @throws UnpricedModelError if `model` is not in the pricing map.
 * @throws MissingUsageMetadataError if `usageMetadata` is absent or both
 *         token counts read as 0/null/undefined.
 */
export function computeGeminiCost(
  model: string,
  response: GeminiResponseLike,
): UsageBreakdown {
  const pricing = GEMINI_PRICING[model];
  if (!pricing) {
    throw new UnpricedModelError(model);
  }

  const usage = response.usageMetadata;
  if (!usage) {
    throw new MissingUsageMetadataError(
      model,
      'response.usageMetadata is undefined',
    );
  }

  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;

  if (inputTokens === 0 && outputTokens === 0) {
    throw new MissingUsageMetadataError(
      model,
      `usageMetadata present but promptTokenCount=${usage.promptTokenCount} ` +
        `candidatesTokenCount=${usage.candidatesTokenCount} ` +
        `totalTokenCount=${usage.totalTokenCount} — all zero/undefined`,
    );
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_mtok_usd;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_mtok_usd;
  const totalCost = inputCost + outputCost;

  return {
    cost_usd: Number(totalCost.toFixed(6)),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
}
