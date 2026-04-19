import { NORA_SYSTEM_PROMPT } from './system-prompt';
import type { NoraContext } from './types';
import type { KnownIssuePattern } from './known-issue-matcher';

/**
 * Compose the system prompt for a single Nora turn.
 *
 * Three layers:
 *   1. NORA_SYSTEM_PROMPT (verbatim founder prompt, ~2600 words)
 *   2. INJECTED SESSION CONTEXT — user identity, plan, surface, and
 *      (if Guildmember) tier/fee/referral/payout/fraud state
 *   3. KNOWN-ISSUE PATTERN MATCHED — only appended when the matcher
 *      found a relevant pattern, carries playbook text Nora reasons
 *      over
 *
 * Extracted from the /turn route to (a) satisfy Next.js 15's
 * route-file export rules and (b) make the composition unit-testable.
 * The route just imports this function.
 */
export function composeSystemPrompt(
  ctx: NoraContext,
  matched: KnownIssuePattern | null,
): string {
  const contextBlock = `

═══ INJECTED SESSION CONTEXT ═══

User identity:
  user_id: ${ctx.user_id}
  email: ${ctx.email}
  primary_language: ${ctx.primary_language}
  plan: ${ctx.plan ?? 'none'}
  is_admin: ${ctx.is_admin}
  account_created_at: ${ctx.account_created_at}

Session:
  surface: ${ctx.surface}
  user_role: ${ctx.user_role}

${ctx.guildmember_id ? formatGuildBlock(ctx) : 'Not a Guild member.'}
`;

  const patternBlock = matched
    ? `

═══ KNOWN-ISSUE PATTERN MATCHED ═══

Your symptom match returned the pattern below. Use its playbook to
answer. If the playbook text does not apply to this user's situation,
say so and either run a different tool or escalate.

pattern_slug: ${matched.pattern_slug}
title: ${matched.title}
${matched.auto_fix_tool ? `auto_fix_tool: ${matched.auto_fix_tool} (tier ${matched.auto_fix_tier ?? '?'})` : ''}

resolution_playbook:
${matched.resolution_playbook ?? '(no playbook text on file)'}
`
    : '';

  return NORA_SYSTEM_PROMPT + contextBlock + patternBlock;
}

function formatGuildBlock(ctx: NoraContext): string {
  return `Guild state:
  guildmember_id: ${ctx.guildmember_id}
  tier: ${ctx.tier ?? '?'}
  guild_status: ${ctx.guild_status ?? '?'}
  referral_code: ${ctx.referral_code ?? '?'}
  guild_joined_at: ${ctx.guild_joined_at ?? '?'}
  primary_market: ${ctx.primary_market ?? '?'}

  fee_window_active: ${ctx.fee_window_active ?? '?'}
  current_monthly_fee_usd: ${ctx.current_monthly_fee_usd ?? 0}
  deferred_balance_usd: ${ctx.deferred_balance_usd ?? 0}
  ${ctx.probation_started_at ? `probation_started_at: ${ctx.probation_started_at}` : ''}
  ${ctx.probation_reason ? `probation_reason: ${ctx.probation_reason}` : ''}

  total_referrals: ${ctx.total_referrals ?? 0}
  retained_referrals: ${ctx.retained_referrals ?? 0}
  referrals_in_gate_window: ${ctx.referrals_in_gate_window ?? 0}

  pending_commission_usd: ${ctx.pending_commission_usd ?? 0}
  unused_grants: ${ctx.unused_grants ?? 0}

  completed_mentor_sessions: ${ctx.completed_mentor_sessions ?? 0}
  mandatory_modules: ${ctx.mandatory_modules_completed ?? 0}/${ctx.mandatory_modules_total ?? 0}

  open_fraud_flags: ${ctx.open_fraud_flags ?? 0}
  open_support_tickets: ${ctx.open_support_tickets ?? 0}`;
}
