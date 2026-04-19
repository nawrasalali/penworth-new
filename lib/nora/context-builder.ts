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
  const { user_id, surface, admin } = args;

  const { data, error } = await admin
    .from('v_nora_member_context')
    .select('*')
    .eq('user_id', user_id)
    .maybeSingle<MemberContextRow>();

  if (error) {
    console.error('[nora:context-builder:error]', { userId: user_id, error });
    return { ok: false, reason: 'member_not_found' };
  }
  if (!data) {
    // Previously silent. A 2026-04-19 prod incident (8× 404 on /start with
    // zero log lines on the Vercel side) proved this branch needed its own
    // signal — when the view query returns successfully but matches zero
    // rows under the current role/RLS, we need to see it in the logs to
    // distinguish "service role bypassed but user has no profile row" from
    // "RLS silently returned empty set under wrong role".
    console.error('[nora:context-builder:no-data]', { userId: user_id });
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
