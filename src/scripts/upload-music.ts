/**
 * Upload music tracks to R2 and print metadata for the Google Sheet.
 *
 * Usage:
 *   npx tsx src/scripts/upload-music.ts /path/to/music-folder
 *
 * Expects .mp3 or .wav files in the folder.
 * Uploads each to R2 under music/{filename} and prints a tab-separated
 * row you can paste into the Music Library sheet.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { uploadFile } from '../lib/r2-storage.js';
import '../config/env.js';

const SUPPORTED = new Set(['.mp3', '.wav', '.m4a', '.ogg']);

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: npx tsx src/scripts/upload-music.ts /path/to/music-folder');
    process.exit(1);
  }

  const files = (await readdir(folder)).filter(f => SUPPORTED.has(extname(f).toLowerCase()));

  if (files.length === 0) {
    console.error('No supported audio files found in', folder);
    process.exit(1);
  }

  console.log(`Found ${files.length} audio files. Uploading to R2...\n`);
  console.log('Title\tArtist\tR2 Key\tDuration (s)\tMood\tGenre\tTempo BPM\tEnergy Level\tLicense Source');
  console.log('─'.repeat(120));

  for (const file of files) {
    const localPath = join(folder, file);
    const r2Key = `music/${file}`;
    const buf = await readFile(localPath);

    const ext = extname(file).toLowerCase();
    const contentType = ext === '.mp3' ? 'audio/mpeg'
      : ext === '.wav' ? 'audio/wav'
      : ext === '.m4a' ? 'audio/mp4'
      : 'audio/ogg';

    await uploadFile(r2Key, buf, contentType);

    const title = basename(file, extname(file)).replace(/[-_]/g, ' ');
    console.log(`${title}\t\t${r2Key}\t\t\t\t\t\t`);
    console.log(`  ✅ Uploaded ${file} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log(`\n✅ All ${files.length} tracks uploaded to R2 under music/`);
  console.log('\nNext steps:');
  console.log('1. Fill in the missing columns (Artist, Duration, Mood, Genre, Tempo BPM, Energy Level, License Source)');
  console.log('2. Paste the rows into the Music Library tab in Google Sheets');
  console.log('3. S6 workflow will pick them up and insert into Supabase within 5 minutes');
}

main().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
