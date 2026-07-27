/** Picks the live Supabase backend when configured, else the demo backend. */

import type { Backend } from './backend';
import { isSupabaseConfigured } from './config';
import { MockBackend } from './mockBackend';
import { SupabaseBackend } from './supabaseBackend';

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (!instance) {
    instance = isSupabaseConfigured ? new SupabaseBackend() : new MockBackend();
  }
  return instance;
}
