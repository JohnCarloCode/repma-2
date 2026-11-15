import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// architecture.md §8 — the anon key serves only Supabase Auth's token grants
// (password login, RF-01; refresh, AD-23), never data. A fresh client per
// call: supabase-js keeps the signed-in session inside the client instance,
// and a shared one would hold whichever user logged in last.
export function createAuthClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
