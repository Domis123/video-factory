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
