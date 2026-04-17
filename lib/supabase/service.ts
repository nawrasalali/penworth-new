import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS; use only server-side for operations where the user-scoped
 * client can't reach (e.g. writing computer_use_sessions for audit/admin
 * purposes, uploading screenshots). Never import this into a client
 * component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
