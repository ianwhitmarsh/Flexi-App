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

/**
 * Which embedded payroll provider to use. Absent means the in-memory demo
 * provider, which is what keeps the app usable with no setup.
 *
 * Only the provider *name* is public. Payroll API keys must never carry an
 * `EXPO_PUBLIC_` prefix — that prefix inlines the value into the client bundle,
 * and a payroll secret in a shipped app is a breach. They belong to the server
 * side that BIG-41 introduces.
 */
export const PAYROLL_PROVIDER = process.env.EXPO_PUBLIC_PAYROLL_PROVIDER ?? '';

export const isPayrollConfigured = PAYROLL_PROVIDER.length > 0;
