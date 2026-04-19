import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS; use only server-side for operations where the user-scoped
 * client can't reach (e.g. writing computer_use_sessions for audit/admin
 * purposes, uploading screenshots). Never import this into a client
 * component.
 *
 * === CRITICAL: global.headers.Authorization is load-bearing ===
 *
 * Passing serviceKey as the second arg to createClient() is not sufficient
 * to guarantee requests run with service role. @supabase/supabase-js@2.49.1
 * constructs its fetcher via fetchWithAuth (lib/fetch.ts), which calls
 * _getAccessToken() before every REST request. That helper runs:
 *
 *     const { data } = await this.auth.getSession();
 *     return data.session?.access_token ?? this.supabaseKey;
 *
 * If a session exists anywhere reachable by the GoTrue client's storage
 * (even indirectly — cached session state, a shared @supabase/auth-js
 * storage adapter, anything returned by getSession() that isn't null),
 * the USER JWT gets attached as the Authorization header and the
 * service-role key is silently ignored. The query runs as the
 * `authenticator` role, not `service_role`, and any RLS policy that
 * depends on bypass fails — including any SECURITY INVOKER view that
 * joins auth.users (which `authenticated` cannot SELECT).
 *
 * Observed in prod (dpl_7xhTXqJXpN8F8dnneHccxP2T8Xwy, 2026-04-19): 8 user
 * clicks on POST /api/nora/conversation/start returned 404. Postgres
 * audit showed 8 matching "permission denied for table users" errors
 * from user=authenticator at matching timestamps, despite the route
 * explicitly constructing the client via createServiceClient().
 *
 * === THE FIX ===
 *
 * Pre-seed the Authorization header via global.headers. SupabaseClient
 * copies these onto `this.headers` and passes them into PostgrestClient
 * construction. When a REST request is made, fetchWithAuth checks:
 *
 *     if (!headers.has('Authorization')) {
 *       headers.set('Authorization', `Bearer ${accessToken}`);
 *     }
 *
 * Because our header is already present, the conditional fails and the
 * dynamically-resolved access token is never attached. The service-role
 * key wins every time, regardless of any stray session state.
 *
 * We set both Authorization and apikey for belt-and-braces — some server
 * paths (e.g. Storage) rely on apikey not being overridden by client
 * plumbing.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  });
}
