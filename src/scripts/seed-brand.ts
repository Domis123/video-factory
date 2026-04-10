/**
 * Seed or update a brand_configs row from a JSON file.
 *
 * Usage:
 *   npx tsx src/scripts/seed-brand.ts brands/nordpilates.json
 *
 * The JSON must contain every NOT NULL column on brand_configs:
 *   brand_id, brand_name, primary_color, secondary_color, font_family,
 *   caption_preset (full JSONB), logo_r2_key.
 *
 * All other columns are optional and default server-side.
 * Upserts on brand_id (ON CONFLICT UPDATE), so the script is idempotent.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { supabaseAdmin } from '../config/supabase.js';

const REQUIRED_FIELDS = [
  'brand_id',
  'brand_name',
  'primary_color',
  'secondary_color',
  'font_family',
  'caption_preset',
  'logo_r2_key',
] as const;

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx src/scripts/seed-brand.ts <path/to/brand.json>');
    process.exit(1);
  }

  const path = resolve(process.cwd(), arg);
  const raw = await readFile(path, 'utf-8');
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Invalid JSON in ${path}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter((f) => row[f] === undefined || row[f] === null);
  if (missing.length > 0) {
    console.error(`❌ ${path} missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`[seed-brand] Upserting ${row.brand_id} from ${path}`);

  const { data, error } = await supabaseAdmin
    .from('brand_configs')
    .upsert(row, { onConflict: 'brand_id' })
    .select('brand_id, brand_name, allowed_video_types, color_grade_preset, logo_r2_key')
    .single();

  if (error) {
    console.error(`❌ Upsert failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`✅ Seeded: ${JSON.stringify(data, null, 2)}`);
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
