import { supabaseAdmin } from '../config/supabase.js';
import { uploadFile } from '../lib/r2-storage.js';

const KEEP = Buffer.from('');

console.log('\n📁 Creating R2 folder structure...\n');

// Top-level folders
const folders = ['assets', 'rendered', 'brands', 'music', 'temp'];
for (const folder of folders) {
  const key = `${folder}/.keep`;
  await uploadFile(key, KEEP);
  console.log(`  ✅ ${key}`);
}

// Per-brand folders
const { data: brands, error } = await supabaseAdmin
  .from('brand_configs')
  .select('brand_id');

if (error) {
  console.error('❌ Failed to fetch brands:', error.message);
  process.exit(1);
}

for (const brand of brands ?? []) {
  const brandFolders = [
    `assets/${brand.brand_id}/.keep`,
    `rendered/${brand.brand_id}/.keep`,
    `brands/${brand.brand_id}/.keep`,
  ];
  for (const key of brandFolders) {
    await uploadFile(key, KEEP);
    console.log(`  ✅ ${key}`);
  }
}

console.log('\n✅ R2 folder structure created.\n');
