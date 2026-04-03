import { analyzeClip } from '../lib/gemini.js';

const filePath = process.argv[2] ?? '/Users/eglemuznikaite/Documents/video-factory/video/babies.mov';

console.log(`\n🔍 Analyzing: ${filePath}\n`);

const result = await analyzeClip(filePath);

console.log(JSON.stringify(result, null, 2));
