import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Upstash Redis (BullMQ)
  REDIS_URL: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Gemini (Clip Analyzer)
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_INGESTION_MODEL: z.string().min(1).default('gemini-3.1-pro-preview'),

  // Anthropic (AI Agents — optional, mock mode if missing)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_ENDPOINT: z.string().url(),

  // Worker Config
  WORKER_ID: z.string().default('worker-local'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  RENDER_TEMP_DIR: z.string().default('/tmp/video-factory'),
  API_PORT: z.coerce.number().int().default(3000),

  // whisper.cpp paths — defaults match the VPS install (/opt/whisper.cpp/...)
  WHISPER_BIN: z.string().default('/opt/whisper.cpp/build/bin/whisper-cli'),
  WHISPER_MODEL: z.string().default('/opt/whisper.cpp/models/ggml-base.en.bin'),

  // ── MVP Feature Flags ──
  // Most quality upgrade phases are gated OFF by default for MVP per
  // VIDEO_PIPELINE_ARCHITECTURE_v3.md. Flip to 'true' to re-enable once
  // the music library is stocked and the end-to-end happy path works.
  ENABLE_BEAT_SYNC: z.string().default('false').transform((v) => v === 'true'),
  ENABLE_COLOR_GRADING: z.string().default('false').transform((v) => v === 'true'),
  ENABLE_MUSIC_SELECTION: z.string().default('false').transform((v) => v === 'true'),
  ENABLE_DYNAMIC_PACING: z.string().default('false').transform((v) => v === 'true'),
  // Phase 3 Creative Director — new parameterized schema (slot_count 3-12, energy_per_slot,
  // color_treatment, per-slot transitions). Off by default until downstream W2/W3/W4 ship.
  ENABLE_PHASE_3_CD: z.string().default('false').transform((v) => v === 'true'),
  // Audio ducking + CRF18 are ON by default — they don't depend on data we don't have yet.
  ENABLE_AUDIO_DUCKING: z.string().default('true').transform((v) => v !== 'false'),
  ENABLE_CRF18_ENCODING: z.string().default('true').transform((v) => v !== 'false'),
  // Single fallback track UUID used when ENABLE_MUSIC_SELECTION=false.
  // Must be a row ID in music_tracks. Empty string = render without background music.
  FALLBACK_MUSIC_TRACK_ID: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
