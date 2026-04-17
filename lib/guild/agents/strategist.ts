/**
 * Guild Strategist Agent
 *
 * Single-shot plan generator. Reads metrics + (optionally) the latest analyst
 * report + latest mentor journal, and produces a one-week plan: specific
 * actions, each with a measurable outcome and a day. Plans are persisted in
 * guild_growth_plans.
 *
 * Not a chat. Not a pep-talk. A plan.
 */

import { ReferralMetrics, GuildMemberCtx } from './shared';
import { AnalystReport } from './analyst';

export interface StrategistAction {
  day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  title: string;         // ≤ 10 words
  description: string;   // 1-2 sentences, imperative voice
  outcome_metric: string; // e.g. "3 DMs sent to target segment X"
  effort_minutes: number;  // rough estimate
  category: 'content' | 'outreach' | 'follow_up' | 'learning' | 'ops';
}

export interface StrategistPlan {
  generated_at: string;
  week_starting: string; // YYYY-MM-DD (next Monday UTC)
  thesis: string;        // one sentence — why this week, why these actions
  actions: StrategistAction[];
  total_minutes: number;
  checkpoint: {
    by: 'wednesday' | 'friday';
    question: string; // what the member asks themselves at checkpoint
  };
  skip_if: string | null; // condition under which the whole plan should be deferred
}

interface StrategistGrounding {
  mentor_last_next_action?: {
    description: string;
    by_date: string;
  } | null;
  analyst_report?: AnalystReport | null;
}

export function buildStrategistPrompt(
  member: GuildMemberCtx,
  metrics: ReferralMetrics,
  grounding: StrategistGrounding,
): string {
  return `You are the Guild Strategist — a pragmatic planner for a Penworth Guild member. You produce ONE plan for ONE week. No more, no less.

Respond with ONLY valid JSON matching this schema (no prose, no markdown fences):

{
  "generated_at": "ISO timestamp",
  "week_starting": "YYYY-MM-DD (next Monday in UTC)",
  "thesis": "one sentence — why this specific plan for this specific week",
  "actions": [
    {
      "day": "mon | tue | wed | thu | fri | sat | sun",
      "title": "≤ 10 words",
      "description": "1-2 sentences, imperative voice (Send…, Write…, Call…)",
      "outcome_metric": "how they'll know they did it (e.g. '3 DMs sent')",
      "effort_minutes": 30,
      "category": "content | outreach | follow_up | learning | ops"
    }
  ],
  "total_minutes": 180,
  "checkpoint": {
    "by": "wednesday | friday",
    "question": "the one question they should ask themselves at checkpoint"
  },
  "skip_if": "condition that would make this plan wrong this week, or null"
}

## Rules
- 3-5 actions total. Not more. Most weeks, 3 is right.
- Total effort between 90 and 300 minutes.
- Every action has a day, a measurable outcome, and an effort estimate.
- Actions must be grounded in the member's real numbers. If they have zero
  referrals after 4 weeks, the plan is about outreach — not content polish.
- If they have strong inbound but weak retention, the plan is about follow-up
  with existing referrals, not new acquisition.
- If momentum is already "accelerating" per the analyst, the plan protects
  momentum — don't introduce unrelated initiatives.
- If there's a pending mentor next_action from last week, carry it into this
  plan as day 1 — don't overwrite it.
- skip_if names a real scenario where the plan shouldn't run this week
  (e.g. "traveling this week — do 2/5 actions instead").

## Member
- Name: ${member.display_name}
- Tier: ${member.tier}
- Market: ${member.primary_market ?? 'unspecified'}
- Primary language: ${member.primary_language}
- Weeks since joining: ${metrics.weeks_since_joined}

## Current metrics
${JSON.stringify(metrics, null, 2)}

## Last mentor next-action (if any)
${JSON.stringify(grounding.mentor_last_next_action ?? null, null, 2)}

## Last analyst report (if any)
${JSON.stringify(grounding.analyst_report ?? null, null, 2)}`;
}

/**
 * Next Monday (UTC) as YYYY-MM-DD. Used as guild_growth_plans.start_date.
 */
export function nextMondayUtc(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const offset = day === 1 ? 7 : (1 - day + 7) % 7 || 7; // always moves forward
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Plan spans 7 days from start.
 */
export function planEndDate(startDate: string): string {
  const d = new Date(startDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}
