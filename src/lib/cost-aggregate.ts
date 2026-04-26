/**
 * cost-aggregate — daily Part B spend aggregator for the n8n cost-alert cron.
 *
 * Mirrors the SQL specified in W9_SHADOW_ROLLOUT_BRIEF.md § "Cost monitoring (Q10b)":
 *   SELECT date_trunc('day', created_at), COUNT(*), SUM(cost), AVG(cost),
 *          PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY cost)
 *   FROM shadow_runs WHERE created_at >= NOW() - INTERVAL '1 day' GROUP BY 1;
 *
 * Implemented in JS (single SELECT + grouping in memory) rather than as a
 * Postgres function so it stays in the same shadow-stack codebase as
 * cutover-status and ships without a separate migration. Cost: O(rows) per
 * call; daily call against a brand running ~3-5 jobs/day is trivial.
 *
 * Per Architecture Rule 38, this helper throws loudly on invalid input
 * (negative or NaN `part_b_cost_usd`). Bad data should not silently roll
 * up into a $5 threshold check.
 *
 * No side effects. n8n cron either calls Supabase RPC directly or hits a
 * tiny Express endpoint that wraps this helper.
 */
import { supabaseAdmin } from '../config/supabase.js';

export type DailyCostAggregate = {
  /** UTC day, YYYY-MM-DD format. */
  day: string;
  /** Total shadow_runs rows that day, regardless of cost-null state. */
  shadow_run_count: number;
  /** Sum across rows with non-null cost (rows with null cost excluded from this and downstream cost stats). */
  daily_total_usd: number;
  /** Mean cost across non-null-cost rows. 0 if no rows have cost. */
  daily_mean_usd: number;
  /** 95th percentile cost across non-null-cost rows (PERCENTILE_DISC). 0 if no rows have cost. */
  daily_p95_usd: number;
};

type ShadowRunCostRow = {
  created_at: string;
  part_b_cost_usd: number | null;
};

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    Math.floor(sortedAsc.length * p),
    sortedAsc.length - 1,
  );
  return sortedAsc[idx]!;
}

function dayKey(iso: string): string {
  // UTC day boundary — matches Postgres date_trunc('day', ...) on TIMESTAMPTZ.
  // Format YYYY-MM-DD.
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function aggregateDailyCosts(
  opts: {
    /** How many days back from now (inclusive of today). Default 1. */
    windowDays?: number;
  } = {},
): Promise<DailyCostAggregate[]> {
  const windowDays = opts.windowDays ?? 1;
  if (!Number.isFinite(windowDays) || windowDays < 1) {
    throw new Error(
      `aggregateDailyCosts: windowDays must be >= 1 finite integer (got ${windowDays})`,
    );
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const { data, error } = await supabaseAdmin
    .from('shadow_runs')
    .select('created_at, part_b_cost_usd')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`aggregateDailyCosts: query failed: ${error.message}`);
  }

  const rows = (data ?? []) as ShadowRunCostRow[];

  // Defensive validation per Rule 38: cost must be non-negative + finite when present.
  for (const r of rows) {
    if (r.part_b_cost_usd === null || r.part_b_cost_usd === undefined) continue;
    const n = Number(r.part_b_cost_usd);
    if (!Number.isFinite(n)) {
      throw new Error(
        `aggregateDailyCosts: shadow_runs row at ${r.created_at} has non-finite part_b_cost_usd=${r.part_b_cost_usd}`,
      );
    }
    if (n < 0) {
      throw new Error(
        `aggregateDailyCosts: shadow_runs row at ${r.created_at} has negative part_b_cost_usd=${n}`,
      );
    }
  }

  const buckets = new Map<string, ShadowRunCostRow[]>();
  for (const r of rows) {
    const key = dayKey(r.created_at);
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(r);
  }

  const out: DailyCostAggregate[] = [];
  for (const [day, dayRows] of buckets) {
    const costsWithValue = dayRows
      .map((r) => r.part_b_cost_usd)
      .filter((n): n is number => n !== null && n !== undefined)
      .sort((a, b) => a - b);
    const total = costsWithValue.reduce((acc, n) => acc + n, 0);
    const mean = costsWithValue.length === 0 ? 0 : total / costsWithValue.length;
    const p95 = percentile(costsWithValue, 0.95);
    out.push({
      day,
      shadow_run_count: dayRows.length,
      daily_total_usd: total,
      daily_mean_usd: mean,
      daily_p95_usd: p95,
    });
  }

  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}
