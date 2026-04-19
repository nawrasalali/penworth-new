import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS; use only server-side for operations where the user-scoped
 * client can't reach (e.g. writing computer_use_sessions for audit/admin
 * purposes, uploading screenshots, cross-user aggregation, admin actions).
 * Never import this into a client component.
 *
 * ============================================================================
 * === WHY COMMIT 13 FAILED (2026-04-19, dpl_7xhTXqJXpN8F8dnneHccxP2T8Xwy) ===
 * ============================================================================
 *
 * Commit 13 tried to force service-role auth by pre-seeding
 * global.headers.Authorization in createClient() options. Empirical result:
 * 3 user clicks on POST /api/nora/conversation/start at 12:35:57, 12:36:00,
 * 12:36:03 UTC all returned 404 with matching 42501 "permission denied for
 * table users" errors from user=authenticator in Postgres logs. Service-role
 * was NOT reaching Postgres despite the global.headers pre-seed.
 *
 * The library source (@supabase/supabase-js@2.103.2 compiled dist) shows
 * fetchWithAuth has a conditional guard:
 *
 *     if (!headers.has("Authorization")) headers.set("Authorization", ...)
 *
 * On paper this should have preserved our pre-seeded Authorization header.
 * But Postgres proved it didn't — a user JWT reached the wire. Per
 * verification chat's analysis, under some runtime condition (possibly
 * related to header normalization, or PostgrestClient's Headers cloning
 * stripping/replacing entries, or session state bleeding through
 * initialization), the global.headers approach does not reliably win.
 *
 * ============================================================================
 * === WHY THIS FIX (OPTION A) SHOULD WORK ============================
 * ============================================================================
 *
 * Instead of trying to WIN the header race after getSession() returns a
 * session, this fix ensures getSession() CANNOT return a session at all.
 *
 * GoTrueClient's __loadSession (auth-js/dist/module/GoTrueClient.js:2304)
 * reads session data from `this.storage` via getItemAsync. With:
 *
 *   persistSession: false          — constructor picks memoryStorage (empty)
 *   autoRefreshToken: false        — no background refresh writing sessions
 *   detectSessionInUrl: false      — no URL-callback session capture on init
 *
 * …the storage is guaranteed to be empty throughout the client's lifetime.
 * getSession() returns { data: { session: null }, error: null }. In
 * SupabaseClient._getAccessToken (supabase-js/dist/index.mjs:523):
 *
 *   const { data } = await this.auth.getSession();
 *   return data.session?.access_token ?? this.supabaseKey;
 *
 * The nullish-coalesce falls through to this.supabaseKey, which is the
 * service-role key we passed as arg 2 to createClient. fetchWithAuth then
 * sets Authorization: Bearer <serviceKey>, and PostgREST sees us as
 * service_role — RLS is bypassed as intended.
 *
 * This is the canonical pattern per Supabase's own server-side docs. It
 * does NOT use the `accessToken` option (which would turn `this.auth` into
 * a throwing Proxy and break admin.auth.admin.* callers — we have 3 such
 * callers: lib/nora/tools/trigger-password-reset.ts, resend-email-
 * confirmation.ts, and lib/compliance-fulfil.ts).
 *
 * ============================================================================
 * === FALLBACK IF THIS STILL DOESN'T WORK ====================================
 * ============================================================================
 *
 * Option C from verification chat: bypass supabase-js entirely for the
 * buildNoraContext query. Use raw fetch to
 *   ${url}/rest/v1/v_nora_member_context?user_id=eq.${userId}
 * with explicit { apikey, Authorization: Bearer ${serviceKey} } headers.
 * Narrow blast radius — touches only context-builder.ts, leaves the 178
 * other service-client callers alone.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
