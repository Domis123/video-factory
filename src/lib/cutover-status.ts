/**
 * cutover-status — pure-function aggregator for the Q5d composite cutover rule.
 *
 * Reads from the `shadow_review` view (migration 012) and computes the four
 * numeric cutover signals plus the creative-quality veto, returning a
 * structured `CutoverStatus` object.
 *
 * Domis runs this on demand (operator decision aid) or via an n8n cron that
 * posts a status row to Sheets. NO side effects — does not flip pipeline_version,
 * does not write back. Cutover is operator-explicit per Q5d.
 *
 * Sample window: the most recent N verdict-populated shadow_review rows for the
 * brand, where N defaults to 30 (Q5d minimum). Verdict-populated means
 * `operator_comparison_verdict IS NOT NULL` — n8n S-workflow only writes this
 * column once an operator has reviewed.
 *
 * Per W9_SHADOW_ROLLOUT_BRIEF.md § "Cutover decision rule (Q5d formalized)".
 */
import { supabaseAdmin } from '../config/supabase.js';

export type CutoverSignals = {
  operator_part_b_better_pct: number;
  operator_v1_better_pct: number;
  escalation_rate_pct: number;
  cost_p95_usd: number;
  feels_organic_pct: number;
};

export type CutoverThresholds = {
  min_comparison_count: number;
  operator_part_b_better_pct_min: number;
  operator_v1_better_pct_max: number;
  escalation_rate_pct_max: number;
  cost_p95_usd_max: number;
  feels_organic_pct_min: number;
};

export type CutoverStatus = {
  brand_id: string;
  comparison_count: number;
  signals: CutoverSignals;
  thresholds: CutoverThresholds;
  signals_passing: Record<keyof CutoverSignals, boolean>;
  veto_blocking: boolean;
  cutover_eligible: boolean;
  blockers: string[];
};

export const CUTOVER_THRESHOLDS: CutoverThresholds = {
  min_comparison_count: 30,
  operator_part_b_better_pct_min: 60,
  operator_v1_better_pct_max: 10,
  escalation_rate_pct_max: 25,
  cost_p95_usd_max: 1.2,
  feels_organic_pct_min: 80,
};

type ReviewRow = {
  part_b_terminal_state: string | null;
  part_b_cost_usd: number | null;
  operator_comparison_verdict: string | null;
  creative_quality_feels_organic: boolean | null;
  created_at: string;
};

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    Math.floor(sortedAsc.length * p),
    sortedAsc.length - 1,
  );
  return sortedAsc[idx]!;
}

export async function getCutoverStatus(
  brandId: string,
  opts: {
    sampleWindow?: number;
    thresholds?: Partial<CutoverThresholds>;
  } = {},
): Promise<CutoverStatus> {
  const thresholds: CutoverThresholds = {
    ...CUTOVER_THRESHOLDS,
    ...opts.thresholds,
  };
  // Default to the min_comparison_count for the window. Larger windows raise
  // confidence at the cost of slower-reacting signal — operator can override.
  const sampleWindow = opts.sampleWindow ?? thresholds.min_comparison_count;

  const { data, error } = await supabaseAdmin
    .from('shadow_review')
    .select(
      'part_b_terminal_state, part_b_cost_usd, operator_comparison_verdict, creative_quality_feels_organic, created_at',
    )
    .eq('brand_id', brandId)
    .not('operator_comparison_verdict', 'is', null)
    .order('created_at', { ascending: false })
    .limit(sampleWindow);

  if (error) {
    throw new Error(
      `getCutoverStatus(${brandId}): shadow_review query failed: ${error.message}`,
    );
  }

  const rows = (data ?? []) as ReviewRow[];
  const comparison_count = rows.length;

  if (comparison_count === 0) {
    const zeroSignals: CutoverSignals = {
      operator_part_b_better_pct: 0,
      operator_v1_better_pct: 0,
      escalation_rate_pct: 0,
      cost_p95_usd: 0,
      feels_organic_pct: 0,
    };
    return {
      brand_id: brandId,
      comparison_count: 0,
      signals: zeroSignals,
      thresholds,
      signals_passing: {
        operator_part_b_better_pct: false,
        operator_v1_better_pct: false,
        escalation_rate_pct: false,
        cost_p95_usd: false,
        feels_organic_pct: false,
      },
      veto_blocking: true,
      cutover_eligible: false,
      blockers: [
        `comparison_count=0 (need ≥${thresholds.min_comparison_count} verdict-populated shadow_review rows for ${brandId})`,
      ],
    };
  }

  const partBBetter = rows.filter(
    (r) => r.operator_comparison_verdict === 'part_b_better',
  ).length;
  const v1Better = rows.filter(
    (r) => r.operator_comparison_verdict === 'v1_better',
  ).length;
  const escalated = rows.filter(
    (r) => r.part_b_terminal_state === 'failed_after_revise_budget',
  ).length;

  const costs = rows
    .map((r) => Number(r.part_b_cost_usd))
    .filter((n): n is number => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const cost_p95_usd = percentile(costs, 0.95);

  // Veto denominator excludes n/a (NULL) — operator-skipped rows shouldn't
  // tank the rate. Sheet column maps yes/no/n/a → true/false/NULL via n8n.
  const organicAnswered = rows.filter(
    (r) => r.creative_quality_feels_organic !== null,
  );
  const organicYes = organicAnswered.filter(
    (r) => r.creative_quality_feels_organic === true,
  ).length;
  const feels_organic_pct =
    organicAnswered.length === 0
      ? 0
      : (organicYes / organicAnswered.length) * 100;

  const signals: CutoverSignals = {
    operator_part_b_better_pct: (partBBetter / comparison_count) * 100,
    operator_v1_better_pct: (v1Better / comparison_count) * 100,
    escalation_rate_pct: (escalated / comparison_count) * 100,
    cost_p95_usd,
    feels_organic_pct,
  };

  const signals_passing: Record<keyof CutoverSignals, boolean> = {
    operator_part_b_better_pct:
      signals.operator_part_b_better_pct >=
      thresholds.operator_part_b_better_pct_min,
    operator_v1_better_pct:
      signals.operator_v1_better_pct <=
      thresholds.operator_v1_better_pct_max,
    escalation_rate_pct:
      signals.escalation_rate_pct <= thresholds.escalation_rate_pct_max,
    cost_p95_usd: signals.cost_p95_usd <= thresholds.cost_p95_usd_max,
    feels_organic_pct:
      signals.feels_organic_pct >= thresholds.feels_organic_pct_min,
  };

  const veto_blocking = !signals_passing.feels_organic_pct;
  const sample_enough = comparison_count >= thresholds.min_comparison_count;
  const numeric_pass =
    signals_passing.operator_part_b_better_pct &&
    signals_passing.operator_v1_better_pct &&
    signals_passing.escalation_rate_pct &&
    signals_passing.cost_p95_usd;
  const cutover_eligible = numeric_pass && !veto_blocking && sample_enough;

  const blockers: string[] = [];
  if (!sample_enough) {
    blockers.push(
      `comparison_count=${comparison_count} < ${thresholds.min_comparison_count} (insufficient sample; collect more verdicts)`,
    );
  }
  if (!signals_passing.operator_part_b_better_pct) {
    blockers.push(
      `operator_part_b_better_pct=${signals.operator_part_b_better_pct.toFixed(1)}% < ${thresholds.operator_part_b_better_pct_min}% (Part B not preferred enough)`,
    );
  }
  if (!signals_passing.operator_v1_better_pct) {
    blockers.push(
      `operator_v1_better_pct=${signals.operator_v1_better_pct.toFixed(1)}% > ${thresholds.operator_v1_better_pct_max}% (v1 still preferred too often)`,
    );
  }
  if (!signals_passing.escalation_rate_pct) {
    blockers.push(
      `escalation_rate_pct=${signals.escalation_rate_pct.toFixed(1)}% > ${thresholds.escalation_rate_pct_max}% (revise-budget exhaustion too frequent)`,
    );
  }
  if (!signals_passing.cost_p95_usd) {
    blockers.push(
      `cost_p95_usd=$${signals.cost_p95_usd.toFixed(2)} > $${thresholds.cost_p95_usd_max.toFixed(2)} (per-video cost ceiling exceeded)`,
    );
  }
  if (veto_blocking) {
    blockers.push(
      `feels_organic_pct=${signals.feels_organic_pct.toFixed(1)}% < ${thresholds.feels_organic_pct_min}% (creative-quality VETO — silent-drift / Betterme-anti-reference signal)`,
    );
  }

  return {
    brand_id: brandId,
    comparison_count,
    signals,
    thresholds,
    signals_passing,
    veto_blocking,
    cutover_eligible,
    blockers,
  };
}
