/**
 * Generate placeholder logo PNGs for the 3 MVP brands and upload them to R2.
 *
 * Placeholders are solid-color 512x512 PNGs with the brand initial painted in
 * white — generated on the fly via ffmpeg (lavfi color source + drawtext).
 * Replace with real brand logos before the first delivered video.
 *
 * R2 keys match the logo_r2_key already set in brands/*.json:
 *   brands/nordpilates/logo.png
 *   brands/ketoway/logo.png
 *   brands/carnimeat/logo.png
 *
 * Usage:
 *   npx tsx src/scripts/upload-brand-logos.ts
 */

import { mkdir, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execOrThrow } from '../lib/exec.js';
import { uploadFile } from '../lib/r2-storage.js';

interface BrandLogo {
  brandId: string;
  label: string;   // short text painted on the placeholder
  bgHex: string;   // hex without the leading #
}

const BRANDS: BrandLogo[] = [
  { brandId: 'nordpilates', label: 'NP', bgHex: 'E8B4A2' },
  { brandId: 'ketoway',     label: 'KW', bgHex: '4CAF50' },
  { brandId: 'carnimeat',   label: 'CM', bgHex: '8B0000' },
];

async function generatePlaceholder(brand: BrandLogo, outPath: string): Promise<void> {
  // ffmpeg's drawtext filter needs a font file. Try common system paths; fall
  // back to omitting text if none are found (the solid-color square is still
  // a legitimate placeholder).
  const fontCandidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',      // Ubuntu/Debian
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',               // Alt Linux
    '/System/Library/Fonts/Helvetica.ttc',                       // macOS
    '/Library/Fonts/Arial.ttf',                                  // macOS alt
  ];
  const { stat } = await import('node:fs/promises');
  let fontPath: string | null = null;
  for (const candidate of fontCandidates) {
    try {
      await stat(candidate);
      fontPath = candidate;
      break;
    } catch {
      // try next
    }
  }

  const vf = fontPath
    ? `color=c=0x${brand.bgHex}:s=512x512,drawtext=fontfile=${fontPath}:text='${brand.label}':fontcolor=white:fontsize=200:x=(w-text_w)/2:y=(h-text_h)/2`
    : `color=c=0x${brand.bgHex}:s=512x512`;

  await execOrThrow({
    command: 'ffmpeg',
    args: ['-y', '-f', 'lavfi', '-i', vf, '-frames:v', '1', outPath],
  });
}

async function main() {
  const tmpDir = '/tmp/brand-logos';
  await mkdir(tmpDir, { recursive: true });

  for (const brand of BRANDS) {
    const localPath = `${tmpDir}/${brand.brandId}-${randomUUID()}.png`;
    try {
      console.log(`[logos] Generating ${brand.brandId} placeholder (bg #${brand.bgHex}, label ${brand.label})`);
      await generatePlaceholder(brand, localPath);

      const pngBytes = await readFile(localPath);
      const r2Key = `brands/${brand.brandId}/logo.png`;
      console.log(`[logos] Uploading ${pngBytes.length} bytes to r2://${r2Key}`);
      await uploadFile(r2Key, pngBytes, 'image/png');
      console.log(`[logos] ✅ ${brand.brandId} → ${r2Key}`);
    } finally {
      await unlink(localPath).catch(() => {});
    }
  }

  console.log('\n✅ All brand logos uploaded. logo_r2_key values in brands/*.json already match.');
}

main().catch((err) => {
  console.error('❌ Logo upload failed:', err);
  process.exit(1);
});
