import { loadBrandPersona } from '../agents/brand-persona.js';

async function main(): Promise<void> {
  console.log('Loading nordpilates persona (first call)...');
  const t0 = Date.now();
  const first = await loadBrandPersona('nordpilates');
  const t1 = Date.now();
  console.log(`First load: ${t1 - t0}ms`);

  console.log('\n=== Parsed frontmatter ===');
  const structured = {
    brand_id: first.brand_id,
    brand_name: first.brand_name,
    schema_version: first.schema_version,
    status: first.status,
    audience: first.audience,
    form_posture_allowlist: first.form_posture_allowlist,
    content_pillars: first.content_pillars,
    allowed_color_treatments: first.allowed_color_treatments,
    preferred_music_intents: first.preferred_music_intents,
    avoid_music_intents: first.avoid_music_intents,
    voice_config: first.voice_config,
  };
  console.log(JSON.stringify(structured, null, 2));

  console.log('\n=== Prose body (first 200 chars) ===');
  console.log(first.prose_body.slice(0, 200));
  if (first.prose_body.length > 200) console.log('...');

  console.log('\n=== Cache check ===');
  const t2 = Date.now();
  const second = await loadBrandPersona('nordpilates');
  const t3 = Date.now();
  console.log(`Second load: ${t3 - t2}ms`);

  if (first !== second) {
    throw new Error('Cache miss on second load — expected same reference');
  }
  console.log('Cache hit confirmed (reference equality on second call)');

  console.log('\n=== Summary ===');
  console.log(`Form×Posture allowlist entries: ${Object.keys(first.form_posture_allowlist).length}`);
  console.log(`Prose body length: ${first.prose_body.length} chars`);
  console.log('All assertions passed.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
