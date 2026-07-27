/**
 * Runtime configuration. Supabase credentials come from EXPO_PUBLIC_* env vars
 * (see .env.example). When they're absent, the app runs against the in-memory
 * demo backend so it's fully usable without any setup.
 */

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

/** Storage bucket that holds uploaded résumés. */
export const RESUME_BUCKET = 'resumes';
