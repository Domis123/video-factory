/**
 * Applies migration 010 (match_segments_v2 RPC) to Supabase and verifies:
 *   1. Function exists in pg_proc.
 *   2. Idempotent re-apply works (DROP+CREATE pattern per Architecture Rule 22).
 *
 * Usage: npx tsx src/scripts/apply-migration-010.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const MIGRATION_FILENAME = '010_match_segments_v2.sql';

function loadEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(resolve(PROJECT_ROOT, '.env'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('[apply-migration-010] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }

  const migrationPath = resolve(PROJECT_ROOT, 'src/scripts/migrations', MIGRATION_FILENAME);
  const sql = readFileSync(migrationPath, 'utf8');
  console.log(`[apply-migration-010] Applying ${MIGRATION_FILENAME} (${sql.length} chars)...`);

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  // Pass 1: apply
  const { error: applyErr } = await sb.rpc('apply_migration_sql', { query: sql });
  if (applyErr) {
    console.error('[apply-migration-010] apply FAILED:', applyErr);
    process.exit(1);
  }
  console.log('[apply-migration-010] apply OK.');

  // NOTIFY pgrst is embedded in the migration, but calling it again is cheap and defensive.
  const { error: notifyErr } = await sb.rpc('apply_migration_sql', {
    query: "NOTIFY pgrst, 'reload schema';",
  });
  if (notifyErr) {
    console.warn(`[apply-migration-010] NOTIFY pgrst failed (non-fatal): ${notifyErr.message}`);
  }

  // Verify function exists via a zero-row probe call. PostgREST schema cache refresh after
  // NOTIFY pgrst is async and can lag a few seconds, so we retry with backoff before giving up.
  const zeroEmbedding = `[${new Array(512).fill(0).join(',')}]`;
  const MAX_VERIFY_ATTEMPTS = 8;
  let verifyOk = false;
  let lastVerifyErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
    const { error: verifyErr, data: verifyRows } = await sb.rpc('match_segments_v2', {
      query_embedding: zeroEmbedding,
      brand_filter: '__nonexistent_brand_verify__',
      segment_type_preferences: [] as string[],
      body_focus_tokens: null,
      slot_role: 'body',
      target_duration_s: 3.0,
      duration_tolerance_s: 2.0,
      subject_hint_parent_asset_id: null,
      min_form_rating: 'beginner_modified',
      min_quality_overall: 5,
      target_count: 5,
      candidate_multiplier: 3,
    });
    if (!verifyErr) {
      if (!Array.isArray(verifyRows) || verifyRows.length !== 0) {
        console.warn(
          `[apply-migration-010] verification call returned unexpected rows (expected []): ${JSON.stringify(verifyRows).slice(0, 200)}`,
        );
      }
      console.log(
        `[apply-migration-010] verification OK on attempt ${attempt} (function callable, zero rows on nonexistent brand).`,
      );
      verifyOk = true;
      break;
    }
    lastVerifyErr = verifyErr;
    const isSchemaCacheLag =
      (verifyErr as { code?: string }).code === 'PGRST202' ||
      String((verifyErr as { message?: string }).message ?? '').includes('schema cache');
    if (!isSchemaCacheLag) break;
    const delayMs = 500 * attempt;
    console.log(
      `[apply-migration-010] verify attempt ${attempt} hit schema cache lag; retrying in ${delayMs}ms...`,
    );
    await new Promise((r) => setTimeout(r, delayMs));
    // re-fire NOTIFY pgrst on each retry for good measure
    await sb.rpc('apply_migration_sql', { query: "NOTIFY pgrst, 'reload schema';" });
  }
  if (!verifyOk) {
    console.error('[apply-migration-010] verification FAILED after retries:', lastVerifyErr);
    process.exit(1);
  }

  // Pass 2: idempotent re-apply. DROP FUNCTION IF EXISTS + CREATE should succeed on repeat.
  console.log('[apply-migration-010] re-applying to confirm idempotency...');
  const { error: reapplyErr } = await sb.rpc('apply_migration_sql', { query: sql });
  if (reapplyErr) {
    console.error('[apply-migration-010] re-apply FAILED (idempotency broken):', reapplyErr);
    process.exit(1);
  }
  console.log('[apply-migration-010] re-apply OK (idempotent).');

  console.log('[apply-migration-010] All checks passed.');
}

main().catch((err) => {
  console.error('[apply-migration-010] Unhandled error:', err);
  process.exit(1);
});
