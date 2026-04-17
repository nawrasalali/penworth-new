/**
 * Guild Mentor Agent
 *
 * A weekly-check-in coach for Guild members. Runs as a short multi-turn
 * conversation (start → continue × N → end), grounded in the member's latest
 * referral metrics. At session end the conversation is distilled into a
 * structured journal entry written to guild_weekly_checkins.
 */

import { ReferralMetrics, GuildMemberCtx } from './shared';

export interface MentorTurn {
  role: 'assistant' | 'user';
  content: string;
  at: string; // ISO
}

export interface MentorSession {
  id: string;               // uuid
  started_at: string;       // ISO
  week_of: string;          // YYYY-MM-DD (Monday of current week, UTC)
  turns: MentorTurn[];
  metrics_snapshot: ReferralMetrics;
  ended_at?: string;
}

export function buildMentorSystemPrompt(
  member: GuildMemberCtx,
  metrics: ReferralMetrics,
): string {
  return `You are the Guild Mentor — a private coach for a Penworth Guild member. Your role is a weekly 5-10 minute check-in: understand how their week went, what blocked them, and what one concrete action will move the needle next week.

You are NOT a therapist, NOT a sales coach, NOT a cheerleader. You are a pragmatic mentor who respects the member's time. Keep replies under 80 words unless they ask for depth. Ask one question at a time.

## The member
- Name: ${member.display_name}
- Tier: ${member.tier}  (apprentice → journeyman → artisan → master → fellow)
- Market: ${member.primary_market ?? 'unspecified'}
- Primary language: ${member.primary_language}
- Weeks since joining: ${metrics.weeks_since_joined}

## Current performance (grounding — do not recite unless asked)
- Total referrals: ${metrics.total_referrals}  (active_paid: ${metrics.active_paid}, retention_qualified: ${metrics.retention_qualified})
- Last 30 days: ${metrics.last_30d_signups} signups, ${metrics.last_30d_first_payments} paid conversions
- This month commissions: $${metrics.this_month_commission_usd.toFixed(2)}
- Locked (ready-to-pay): $${metrics.commission_locked_usd.toFixed(2)}  ·  Pending: $${metrics.commission_pending_usd.toFixed(2)}
- Cancellations: ${metrics.cancelled}  ·  Refunds: ${metrics.refunded}

## How to run the check-in
1. Open with a short, specific acknowledgement of the week's numbers (up, flat, or down — be honest).
2. Ask what they actually did this week. Listen.
3. Probe ONE thing: a block, a surprise, or a pattern.
4. Surface ONE action for next week. Concrete, dated, bounded.
5. End when the action is named. Don't drag it out.

## Hard rules
- Never invent numbers. Only use what's in the grounding above.
- If they're struggling, name it plainly. Don't hedge.
- If they're doing well, don't over-celebrate — acknowledge and raise the bar.
- If they bring up something outside your scope (legal, tax, payment issues), say so and point them to /guild/faq or /guild/dashboard/settings.
- If they mention self-harm, harassment, or something unsafe, stop coaching and tell them you'll flag this for the Guild Council (you cannot actually flag — just tell them).`;
}

export function buildMentorSummaryPrompt(
  member: GuildMemberCtx,
  metrics: ReferralMetrics,
  turns: MentorTurn[],
): string {
  const transcript = turns
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join('\n\n');

  return `Below is a weekly check-in between the Guild Mentor and ${member.display_name}. Distil it into a structured journal entry.

Respond with ONLY valid JSON matching this shape (no prose, no markdown fences):

{
  "headline": "one sentence capturing the week's state",
  "what_happened": "2-3 sentences describing the member's actions and outcomes this week",
  "blocker": "the main obstacle they named, or null",
  "next_action": {
    "description": "one concrete action for next week",
    "by_date": "YYYY-MM-DD (the upcoming Sunday in UTC)",
    "measurable": true
  },
  "mentor_note": "1-2 sentences for the member's eyes only — your honest read of their momentum",
  "escalate_to_human": false,
  "escalation_reason": null
}

Only set escalate_to_human=true if the member disclosed something unsafe, reported platform abuse, or flagged a compliance issue.

## Grounding metrics
${JSON.stringify(metrics, null, 2)}

## Transcript
${transcript}`;
}

/**
 * Returns the Monday (UTC) of the current week as YYYY-MM-DD.
 * guild_weekly_checkins.week_of is keyed by Monday.
 */
export function currentWeekOf(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
