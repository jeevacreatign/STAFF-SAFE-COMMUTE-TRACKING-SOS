import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireEnv } from './http.ts';

/** Service-role client. Bypasses RLS: only use after the caller has been authorised. */
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the caller, so database RLS and function checks apply to them. */
export function callerClient(req: Request): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}
