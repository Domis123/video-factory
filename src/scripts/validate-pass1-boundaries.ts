import { mkdirSync, writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../config/supabase.js';
import { analyzeSegmentBoundariesV2 } from '../lib/gemini-segments-v2.js';
import { env } from '../config/env.js';
import type { BoundariesPass, BoundariesPassItem } from '../agents/segment-analyzer-v2-schema.js';

const TEST_SEGMENT_IDS = [
  'f9788090-f755-4bf1-afd1-6272df9fe225', // exercise — spider plank, right leg
  '03c60575-5b59-45e1-b69e-e5c2aa70c38d', // hold — forearm plank
  'f36d686b-9afc-47cf-a067-67edf59321ac', // talking-head
];

const BRAND_CONTEXT = 'nordpilates — pilates/flexibility/wellness content';
const ARTIFACT_DIR = '/tmp/w0b2-pass1-validation';

// Prompt caps (mirror src/agents/prompts/segment-analyzer-v2-pass1.md)
const MAX_S_BY_TYPE: Record<string, number> = {
  exercise: 12,
  hold: 15,
};
const MAX_S_DEFAULT = 20;
const MIN_S = 1.5;

interface V1Row {
  id: string;
  start_s: number;
  end_s: number;
  segment_type: string;
  description: string;
}

interface ParentRow {
  id: string;
  pre_normalized_r2_key: string | null;
  r2_key: string;
  duration_seconds: number | null;
}

interface OverlapMatch {
  v2_index: number;
  v2_type: string;
  overlap_s: number;
  frac_of_v1: number;
  frac_of_v2: number;
}

interface V1Analysis {
  v1_id: string;
  v1_window: string;
  v1_type: string;
  v2_matches: OverlapMatch[];
  relation: '1:1' | 'split' | 'merge' | 'partial' | 'no-overlap';
  type_change: string | null;
}

interface V2Violation {
  v2_index: number;
  window: string;
  segment_type: string;
  duration_s: number;
  rule: string;
}

interface ParentReport {
  parent_asset_id: string;
  parent_r2_key: string;
  parent_duration_s: number | null;
  v1_count: number;
  v2_count: number;
  count_delta: number;
  v1_covered_s: number;
  v2_covered_s: number;
  parent_duration_proxy_s: number;
  v1_segments: V1Row[];
  v2_segments: BoundariesPassItem[];
  matching: V1Analysis[];
  duration_violations: V2Violation[];
  type_reclassifications: Array<{
    v1_id: string;
    v1_type: string;
    v2_type: string;
    v2_window: string;
    note: string;
  }>;
  subjective_read: string;
}

async function resolveParent(segmentId: string): Promise<{ parent: ParentRow; viaSegment: string }> {
  const { data: seg, error: segErr } = await supabaseAdmin
    .from('asset_segments')
    .select('id, parent_asset_id')
    .eq('id', segmentId)
    .single();
  if (segErr || !seg) {
    throw new Error(`asset_segments lookup failed for ${segmentId}: ${segErr?.message ?? 'not found'}`);
  }
  const parentId = (seg as { parent_asset_id: string }).parent_asset_id;

  const { data: parent, error: parentErr } = await supabaseAdmin
    .from('assets')
    .select('id, pre_normalized_r2_key, r2_key, duration_seconds')
    .eq('id', parentId)
    .single();
  if (parentErr || !parent) {
    throw new Error(`assets lookup failed for ${parentId}: ${parentErr?.message ?? 'not found'}`);
  }
  return { parent: parent as ParentRow, viaSegment: segmentId };
}

async function loadV1Segments(parentId: string): Promise<V1Row[]> {
  const { data, error } = await supabaseAdmin
    .from('asset_segments')
    .select('id, start_s, end_s, segment_type, description')
    .eq('parent_asset_id', parentId)
    .order('start_s', { ascending: true });
  if (error) throw new Error(`v1 segments query failed for ${parentId}: ${error.message}`);
  return (data ?? []) as V1Row[];
}

function overlapSeconds(a: { start_s: number; end_s: number }, b: { start_s: number; end_s: number }): number {
  const lo = Math.max(a.start_s, b.start_s);
  const hi = Math.min(a.end_s, b.end_s);
  return Math.max(0, hi - lo);
}

function classifyMatches(matches: OverlapMatch[]): V1Analysis['relation'] {
  const significant = matches.filter((m) => m.overlap_s >= 0.5);
  if (significant.length === 0) return 'no-overlap';
  if (significant.length >= 2) return 'split';
  const only = significant[0];
  if (only.frac_of_v1 >= 0.5 && only.frac_of_v2 >= 0.5) return '1:1';
  // v2 is much larger than v1 → merge (several v1s share this v2)
  if (only.frac_of_v1 >= 0.5 && only.frac_of_v2 < 0.5) return 'merge';
  return 'partial';
}

function buildReport(
  parentId: string,
  parent: ParentRow,
  v1: V1Row[],
  v2: BoundariesPass,
): ParentReport {
  const parentDurationProxy = Math.max(
    v1.length > 0 ? Math.max(...v1.map((r) => r.end_s)) : 0,
    v2.length > 0 ? Math.max(...v2.map((r) => r.end_s)) : 0,
  );

  const v1Covered = v1.reduce((acc, r) => acc + Math.max(0, r.end_s - r.start_s), 0);
  const v2Covered = v2.reduce((acc, r) => acc + Math.max(0, r.end_s - r.start_s), 0);

  const matching: V1Analysis[] = v1.map((v1Seg) => {
    const matches: OverlapMatch[] = v2
      .map((v2Seg, v2_index) => {
        const overlap = overlapSeconds(v1Seg, v2Seg);
        const v1Len = Math.max(v1Seg.end_s - v1Seg.start_s, 0.0001);
        const v2Len = Math.max(v2Seg.end_s - v2Seg.start_s, 0.0001);
        return {
          v2_index,
          v2_type: v2Seg.segment_type,
          overlap_s: Number(overlap.toFixed(2)),
          frac_of_v1: Number((overlap / v1Len).toFixed(2)),
          frac_of_v2: Number((overlap / v2Len).toFixed(2)),
        };
      })
      .filter((m) => m.overlap_s > 0)
      .sort((a, b) => b.overlap_s - a.overlap_s);

    const relation = classifyMatches(matches);
    const primary = matches[0];
    const type_change =
      primary && primary.v2_type !== v1Seg.segment_type
        ? `${v1Seg.segment_type} → ${primary.v2_type}`
        : null;

    return {
      v1_id: v1Seg.id,
      v1_window: `${v1Seg.start_s.toFixed(1)}-${v1Seg.end_s.toFixed(1)}s`,
      v1_type: v1Seg.segment_type,
      v2_matches: matches,
      relation,
      type_change,
    };
  });

  const type_reclassifications = matching
    .filter((m) => m.type_change !== null && m.v2_matches.length > 0)
    .map((m) => {
      const primary = m.v2_matches[0];
      const v2Seg = v2[primary.v2_index];
      const note =
        (m.v1_type === 'exercise' && (primary.v2_type === 'setup' || primary.v2_type === 'transition'))
          ? 'prep-clip filtering win'
          : (m.v1_type === primary.v2_type)
          ? '' // shouldn't happen given filter, safety
          : 'type disagreement';
      return {
        v1_id: m.v1_id,
        v1_type: m.v1_type,
        v2_type: primary.v2_type,
        v2_window: `${v2Seg.start_s.toFixed(1)}-${v2Seg.end_s.toFixed(1)}s`,
        note,
      };
    });

  const duration_violations: V2Violation[] = [];
  for (const [v2_index, v2Seg] of v2.entries()) {
    const duration = v2Seg.end_s - v2Seg.start_s;
    const cap = MAX_S_BY_TYPE[v2Seg.segment_type] ?? MAX_S_DEFAULT;
    const window = `${v2Seg.start_s.toFixed(1)}-${v2Seg.end_s.toFixed(1)}s`;
    if (duration > cap) {
      duration_violations.push({
        v2_index,
        window,
        segment_type: v2Seg.segment_type,
        duration_s: Number(duration.toFixed(2)),
        rule: `> ${cap}s cap for ${v2Seg.segment_type}`,
      });
    } else if (duration < MIN_S) {
      duration_violations.push({
        v2_index,
        window,
        segment_type: v2Seg.segment_type,
        duration_s: Number(duration.toFixed(2)),
        rule: `< ${MIN_S}s minimum`,
      });
    }
  }

  return {
    parent_asset_id: parentId,
    parent_r2_key: parent.pre_normalized_r2_key ?? parent.r2_key,
    parent_duration_s: parent.duration_seconds,
    v1_count: v1.length,
    v2_count: v2.length,
    count_delta: v2.length - v1.length,
    v1_covered_s: Number(v1Covered.toFixed(1)),
    v2_covered_s: Number(v2Covered.toFixed(1)),
    parent_duration_proxy_s: Number(parentDurationProxy.toFixed(1)),
    v1_segments: v1,
    v2_segments: v2,
    matching,
    duration_violations,
    type_reclassifications,
    subjective_read: '', // agent fills this in the printed summary; kept empty here
  };
}

function printSummary(report: ParentReport, viaSegment: string): void {
  console.log('\n==============================================');
  console.log(`=== PARENT ${report.parent_asset_id} (via seg ${viaSegment}) ===`);
  console.log('==============================================');
  console.log(`R2 key:             ${report.parent_r2_key}`);
  console.log(`Parent duration:    ${report.parent_duration_s ?? 'unknown'}s (max-end proxy ${report.parent_duration_proxy_s}s)`);
  console.log(`v1 segments:        ${report.v1_count}  covered=${report.v1_covered_s}s`);
  console.log(`v2 Pass 1 segments: ${report.v2_count}  covered=${report.v2_covered_s}s`);
  console.log(`Count delta:        ${report.count_delta >= 0 ? '+' : ''}${report.count_delta}`);

  console.log('\n-- v2 Pass 1 segments --');
  for (const [i, v2Seg] of report.v2_segments.entries()) {
    const dur = (v2Seg.end_s - v2Seg.start_s).toFixed(1);
    console.log(
      `  [${i}] ${v2Seg.start_s.toFixed(1)}-${v2Seg.end_s.toFixed(1)}s (${dur}s) ${v2Seg.segment_type}  ${v2Seg.preliminary_notes}`,
    );
  }

  console.log('\n-- v1 → v2 matching --');
  for (const m of report.matching) {
    const primary = m.v2_matches[0];
    const matchStr = primary
      ? `v2[${primary.v2_index}] ${primary.v2_type} (overlap ${primary.overlap_s}s, ${Math.round(primary.frac_of_v1 * 100)}% of v1)`
      : 'no overlap';
    console.log(`  ${m.v1_window} ${m.v1_type.padEnd(12)} → ${m.relation.padEnd(10)} ${matchStr}`);
  }

  if (report.type_reclassifications.length > 0) {
    console.log('\n-- Type reclassifications --');
    for (const r of report.type_reclassifications) {
      console.log(`  ${r.v2_window} ${r.v1_type} → ${r.v2_type}  (${r.note})`);
    }
  } else {
    console.log('\n-- Type reclassifications: none --');
  }

  if (report.duration_violations.length > 0) {
    console.log('\n-- Duration violations --');
    for (const v of report.duration_violations) {
      console.log(`  v2[${v.v2_index}] ${v.window} ${v.segment_type} ${v.duration_s}s — ${v.rule}`);
    }
  } else {
    console.log('\n-- Duration violations: none --');
  }
}

async function main(): Promise<void> {
  console.log(`[validate-pass1] Model: ${env.GEMINI_INGESTION_MODEL}`);
  console.log(`[validate-pass1] Brand context: ${BRAND_CONTEXT}`);
  console.log(`[validate-pass1] Input segments: ${TEST_SEGMENT_IDS.length}`);

  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const parentMap = new Map<string, { parent: ParentRow; viaSegment: string }>();
  for (const segId of TEST_SEGMENT_IDS) {
    const resolved = await resolveParent(segId);
    if (!parentMap.has(resolved.parent.id)) {
      parentMap.set(resolved.parent.id, resolved);
    }
  }
  console.log(`[validate-pass1] Unique parents: ${parentMap.size}`);

  const overall = Date.now();

  for (const { parent, viaSegment } of parentMap.values()) {
    const parentId = parent.id;
    const started = Date.now();
    console.log(`\n[validate-pass1] Processing parent ${parentId}...`);

    const v1 = await loadV1Segments(parentId);
    const parentR2Key = parent.pre_normalized_r2_key ?? parent.r2_key;
    if (!parentR2Key) {
      console.error(`  SKIP: no r2 key on parent ${parentId}`);
      continue;
    }

    let v2: BoundariesPass;
    try {
      v2 = await analyzeSegmentBoundariesV2(parentR2Key, BRAND_CONTEXT);
    } catch (err) {
      console.error(`  Pass 1 ERROR: ${(err as Error).message}`);
      continue;
    }

    const report = buildReport(parentId, parent, v1, v2);
    printSummary(report, viaSegment);

    const artifactPath = `${ARTIFACT_DIR}/${parentId}.json`;
    writeFileSync(artifactPath, JSON.stringify(report, null, 2));
    console.log(`\nArtifact written: ${artifactPath}`);
    console.log(`Wall time: ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  console.log(`\n[validate-pass1] Total wall time: ${((Date.now() - overall) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[validate-pass1] FATAL:', err);
  process.exit(1);
});
