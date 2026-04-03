import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
