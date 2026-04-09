import { listFiles, deleteFile } from '../lib/r2-storage.js';

async function main() {
  const keys = await listFiles('music/');
  console.log(`Found ${keys.length} files in R2 music/:`);
  for (const k of keys) console.log(`  ${k}`);

  if (keys.length === 0) {
    console.log('Nothing to clean.');
    return;
  }

  for (const k of keys) {
    await deleteFile(k);
    console.log(`  🗑️  Deleted: ${k}`);
  }
  console.log(`\n✅ Cleaned ${keys.length} files from R2 music/`);
}

main().catch(err => { console.error(err); process.exit(1); });
