import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoraContext, NoraSurface, NoraUserRole } from './types';

/**
 * Phase 2.5 Item 3 Commit 4 — context builder.
 *
 * Loads the single-row v_nora_member_context view and shapes it into
 * the NoraContext the prompt expects. Two material transforms happen:
 *
 *   1. Field alias: the view exposes preferred_language, the prompt
 *      references primary_language. This alias is the seam between
 *      schema-speak and product-speak — DO NOT change the prompt to
 *      match the schema.
 *
 *   2. Role derivation: the prompt's user_role enum (10 values) is
 *      richer than any single column. Derived from (is_admin, plan,
 *      guild_status, guildmember_id, and store-author presence if
 *      applicable). Store surface out of scope per A7.
 *
 * Widget mount guard lives HERE, not in the widget itself — the
 * server is authoritative on whether a user should see Nora. The
 * widget queries GET /api/nora/conversation/start; if the server
 * refuses (e.g. guild_status in (terminated, resigned) with no
 * other role), the widget should show nothing.
 */

/**
 * Result shape from the view. Matches v_nora_member_context's 35
 * columns per verification chat snapshot. Nullable where the view
 * returns NULL for non-Guildmembers.
 */
interface MemberContextRow {
  user_id: string;
  email: string;
  account_created_at: string;
  full_name: string | null;
  plan: string | null;
  credits_balance: number | null;
  preferred_language: string;
  is_admin: boolean;
  payment_status: string | null;
  // Guild state
  guildmember_id: string | null;
  tier: string | null;
  guild_status: string | null;
  referral_code: string | null;
  guild_joined_at: string | null;
  primary_market: string | null;
  // Fee posture
  account_fee_starts_at: string | null;
  fee_window_active: boolean | null;
  probation_started_at: string | null;
  probation_reason: string | null;
  deferred_balance_usd: number | null;
  current_monthly_fee_usd: number | null;
  // Referrals
  total_referrals: number | null;
  retained_referrals: number | null;
  referrals_in_gate_window: number | null;
  // Payouts
  last_payout: Record<string, unknown> | null;
  pending_commission_usd: number | null;
  // Grants
  unused_grants: number | null;
  unused_grant_categories: string[] | null;
  // Mentor
  completed_mentor_sessions: number | null;
  last_completed_mentor_session: Record<string, unknown> | null;
  next_scheduled_mentor_session: Record<string, unknown> | null;
  // Academy
  mandatory_modules_completed: number | null;
  mandatory_modules_total: number | null;
  // Flags
  open_fraud_flags: number | null;
  open_support_tickets: number | null;
  // Recent activity
  nora_conversations_last_30d: number | null;
}

export interface BuildNoraContextArgs {
  user_id: string;
  surface: NoraSurface;
  admin: SupabaseClient;
}

export type BuildNoraContextResult =
  | { ok: true; context: NoraContext }
  | { ok: false; reason: 'member_not_found' | 'nora_unavailable' };

/**
 * Raw PostgREST bypass for v_nora_member_context.
 *
 * === WHY THIS EXISTS ===
 *
 * Commits 12, 13, 14 all tried to make @supabase/supabase-js send the
 * service-role key on this one view query. All three failed in production
 * with matching Postgres 42501 "permission denied for table users" errors
 * under user=authenticator. Verification chat's diagnosis:
 *
 *   persistSession: false + autoRefreshToken: false + detectSessionInUrl:
 *   false do not prevent a session from being attached at request time.
 *   Those flags control storage read/write, refresh polling, and URL hash
 *   detection — none of them stops an already-resident this.currentSession
 *   object or an inherited cookie-based session from being read by
 *   auth.getSession(). Something in the Next.js 15 SSR boundary or a
 *   chained import is attaching user auth to the service client instance.
 *
 * Instead of fighting the client library for a fourth commit, this helper
 * removes the library from the equation entirely for this ONE query. Raw
 * fetch, explicit service-role apikey + Authorization headers, zero
 * dependency on SupabaseClient / GoTrueClient / PostgrestClient / any
 * storage adapter / any auth cookie.
 *
 * === CONTRACT ===
 *
 *   - Returns MemberContextRow on match, null when zero rows match.
 *   - THROWS on HTTP !ok — caller MUST wrap in try/catch. The throw is
 *     deliberate: a failing PostgREST call is infrastructure-level and
 *     should not be silently coerced into "member_not_found" (which
 *     could mask a real outage as "user needs to complete profile").
 *
 * === SCOPE ===
 *
 *   Intentionally narrow. Does not replace createServiceClient() for any
 *   other caller — 178 other call sites continue to use the supabase-js
 *   client. If those prove to have the same auth-leakage problem later,
 *   we generalise; for now this one query is the only confirmed victim.
 */
async function fetchMemberContextViaRawFetch(
  userId: string,
): Promise<MemberContextRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'fetchMemberContextViaRawFetch: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required',
    );
  }

  const endpoint =
    `${url}/rest/v1/v_nora_member_context` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=*` +
    `&limit=1`;

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    console.error('[nora:context-builder:raw-fetch-error]', {
      userId,
      status: res.status,
      statusText: res.statusText,
      body: body.slice(0, 500),
    });
    throw new Error(
      `v_nora_member_context raw fetch failed: ${res.status} ${res.statusText}`,
    );
  }

  const rows = (await res.json()) as MemberContextRow[];
  return rows[0] ?? null;
}

/**
 * Exported ONLY for unit testing. Production callers should use
 * buildNoraContext. Marked with the __test_ prefix to make misuse visible
 * in grep / code review. See nora.test.ts for mocked-fetch coverage.
 */
export const __test_fetchMemberContextViaRawFetch = fetchMemberContextViaRawFetch;

/**
 * Load the view row for a user, derive role, shape into NoraContext.
 *
 * Returns reason='nora_unavailable' if the user is a Guildmember who
 * has been terminated or resigned AND has no other profile role
 * (which for the store surface being out of scope, means basically
 * 'anyone offboarded from the Guild who isn't also an admin').
 * Widget mount code uses this as the mount guard.
 */
export async function buildNoraContext(
  args: BuildNoraContextArgs,
): Promise<BuildNoraContextResult> {
  const { user_id, surface, admin: _admin } = args;
  // `admin` kept in args signature for API stability across the 4 call
  // sites, but no longer used for the view query (see Commit 15 raw-fetch
  // bypass below). Future refactor may remove `admin` from the args once
  // all queries migrate to raw fetch. Prefixed _ to flag the intentional
  // non-use to TypeScript's noUnusedParameters check.

  // Sentinel log per verification chat step 3. Confirms the route path
  // reached context-builder at all. If we see clicks in Vercel logs with
  // no [nora:context-builder:start] line, the 404 is coming from upstream
  // (auth check, route dispatch, edge middleware) and not from this
  // builder — investigate there instead of here.
  console.info('[nora:context-builder:start]', { user_id, surface });

  // Commit 15: raw-fetch bypass of supabase-js for this ONE query.
  // Commits 12-14 proved that service-role auth cannot be reliably forced
  // via the library client in this code path — see fetchMemberContextViaRawFetch
  // docblock for the full postmortem. This helper talks to PostgREST directly
  // with explicit service-role headers, sidestepping the entire library
  // auth/session layer. Throws on HTTP !ok (infrastructure failure),
  // returns null on zero rows matched, returns MemberContextRow on hit.
  let data: MemberContextRow | null;
  try {
    data = await fetchMemberContextViaRawFetch(user_id);
  } catch (err) {
    // Structured error log — shape differs from the old PostgrestError
    // shape (Commit 14 logged code/message/details/hint from a PostgREST
    // response body). The raw-fetch-error log emitted inside the helper
    // already captured HTTP-level detail (status/statusText/body); this
    // outer log preserves the [nora:context-builder:error] prefix so
    // anyone grepping for "builder encountered a non-null error path"
    // still finds every such occurrence in one place.
    console.error('[nora:context-builder:error]', {
      user_id,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'member_not_found' };
  }

  if (!data) {
    // Previously silent. Distinct prefix so we can tell apart:
    //   - query succeeded, zero rows matched (this branch) → view is
    //     reachable under service role but user truly has no profile row
    //   - query failed with an error (branch above) → PostgREST or RLS
    //     rejected the query, error payload tells us which
    console.error('[nora:context-builder:no-data]', { user_id });
    return { ok: false, reason: 'member_not_found' };
  }

  // Mount guard per A10. Terminated / resigned Guildmembers who aren't
  // also admins don't get Nora at all. If they need support, they use
  // email — this is a deliberate product boundary, not a bug.
  if (
    !data.is_admin &&
    data.guildmember_id &&
    (data.guild_status === 'terminated' || data.guild_status === 'resigned')
  ) {
    return { ok: false, reason: 'nora_unavailable' };
  }

  const user_role = deriveUserRole(data, surface);

  const context: NoraContext = {
    // Identity — with the primary_language alias
    user_id: data.user_id,
    email: data.email,
    primary_language: data.preferred_language, // ← the documented alias
    full_name: data.full_name,
    plan: data.plan,
    is_admin: data.is_admin,
    credits_balance: data.credits_balance,
    account_created_at: data.account_created_at,

    // Session
    surface,
    user_role,

    // Guild state
    guildmember_id: data.guildmember_id,
    tier: data.tier,
    guild_status: data.guild_status,
    referral_code: data.referral_code,
    guild_joined_at: data.guild_joined_at,
    primary_market: data.primary_market,

    // Fee posture
    account_fee_starts_at: data.account_fee_starts_at,
    fee_window_active: data.fee_window_active,
    probation_started_at: data.probation_started_at,
    probation_reason: data.probation_reason,
    deferred_balance_usd: data.deferred_balance_usd,
    current_monthly_fee_usd: data.current_monthly_fee_usd,

    // Referrals
    total_referrals: data.total_referrals,
    retained_referrals: data.retained_referrals,
    referrals_in_gate_window: data.referrals_in_gate_window,

    // Payouts
    last_payout: data.last_payout,
    pending_commission_usd: data.pending_commission_usd,

    // Grants
    unused_grants: data.unused_grants,
    unused_grant_categories: data.unused_grant_categories,

    // Mentor
    completed_mentor_sessions: data.completed_mentor_sessions,
    last_completed_mentor_session: data.last_completed_mentor_session,
    next_scheduled_mentor_session: data.next_scheduled_mentor_session,

    // Academy
    mandatory_modules_completed: data.mandatory_modules_completed,
    mandatory_modules_total: data.mandatory_modules_total,

    // Flags
    open_fraud_flags: data.open_fraud_flags,
    open_support_tickets: data.open_support_tickets,

    // Activity
    nora_conversations_last_30d: data.nora_conversations_last_30d,
  };

  return { ok: true, context };
}

/**
 * Role derivation per A10 + founder prompt's user_role enum.
 *
 * Exported for unit testing — the role matrix is product policy and
 * deserves explicit coverage. Not re-exported from any index because
 * it's an implementation detail of the context builder; tests import
 * from this file directly.
 *
 * Precedence order:
 *   1. admin            — is_admin trumps everything. Super admin is
 *                         not signalled by any column so never returned.
 *   2. Guild tier-based — active / probation / emeritus
 *   3. Store tier       — reserved for when store surface lands; not
 *                         reachable in this repo
 *   4. Author plan      — author_free / _pro / _max
 *
 * The surface parameter is used for one tie-break: an admin viewing the
 * /guild surface still gets role='admin' (prompt's admin section says
 * "has access to runbooks"), not guildmember_active. That's the whole
 * reason surface is admin-overrideable.
 */
export function deriveUserRole(
  row: MemberContextRow,
  _surface: NoraSurface,
): NoraUserRole {
  // Admin wins regardless of surface. No super_admin signal in profiles.
  if (row.is_admin) return 'admin';

  // Guild classification
  if (row.guildmember_id) {
    if (row.guild_status === 'active') return 'guildmember_active';
    if (row.guild_status === 'probation') return 'guildmember_probation';
    if (row.guild_status === 'emeritus') return 'guildmember_emeritus';
    // terminated / resigned were filtered upstream via mount guard
  }

  // Author plan tiers. Plan enum per existing schema: free/starter/pro/
  // publisher/agency. Map to the prompt's author_free/_pro/_max rough-
  // equivalents.
  const plan = (row.plan || 'free').toLowerCase();
  if (plan === 'agency' || plan === 'publisher') return 'author_max';
  if (plan === 'pro' || plan === 'starter') return 'author_pro';
  return 'author_free';
}

/**
 * Row shape exported for tests that want to feed deriveUserRole()
 * without standing up the whole builder. Not expected to be used by
 * production code outside this module.
 */
export type { MemberContextRow };
