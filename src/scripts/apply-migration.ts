import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

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

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: tsx src/scripts/apply-migration.ts <filename>');
    console.error('Example: tsx src/scripts/apply-migration.ts 004_add_full_brief_column.sql');
    process.exit(1);
  }

  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error('[apply-migration] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }

  const migrationPath = resolve(PROJECT_ROOT, 'src/scripts/migrations', filename);
  const sql = readFileSync(migrationPath, 'utf8');
  console.log(`[apply-migration] Applying ${filename} (${sql.length} chars)...`);

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const { error } = await sb.rpc('apply_migration_sql', { query: sql });
  if (error) {
    console.error('[apply-migration] FAILED:', error);
    process.exit(1);
  }

  // Refresh PostgREST schema cache so new columns/functions are immediately queryable.
  const { error: notifyErr } = await sb.rpc('apply_migration_sql', {
    query: "NOTIFY pgrst, 'reload schema';",
  });
  if (notifyErr) {
    console.warn(`[apply-migration] NOTIFY pgrst failed (non-fatal): ${notifyErr.message}`);
  }

  console.log(`[apply-migration] Migration ${filename} applied successfully`);

  // Optional verification: if migration adds a column, confirm via information_schema.
  const addColMatch = sql.match(
    /ALTER TABLE\s+(?:\w+\.)?(\w+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)/i,
  );
  if (addColMatch) {
    const [, table, column] = addColMatch;
    console.log(`[apply-migration] Verifying ${table}.${column}...`);

    const { data, error: verifyErr } = await sb
      .schema('information_schema' as unknown as 'public')
      .from('columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', table)
      .eq('column_name', column);

    if (verifyErr) {
      console.warn(
        `[apply-migration] information_schema query unavailable (${verifyErr.message}); falling back to direct column probe`,
      );
      const { error: probeErr } = await sb.from(table).select(`id, ${column}`).limit(1);
      if (probeErr) {
        console.error(`[apply-migration] Fallback probe failed: ${probeErr.message}`);
        process.exit(1);
      }
      console.log(`[apply-migration] Verification OK (fallback): ${table}.${column} is queryable`);
    } else {
      console.log(`[apply-migration] Verification: ${JSON.stringify(data)}`);
    }
  }
}

main().catch((err) => {
  console.error('[apply-migration] Unhandled error:', err);
  process.exit(1);
});
