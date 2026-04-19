import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  loadReferralMetrics,
  getAgentContext,
  setAgentContext,
  logGuildAgentUsage,
  type GuildMemberCtx,
} from '@/lib/guild/agents/shared';
import {
  type AnalystReport,
  type TimeseriesPoint,
  buildAnalystPrompt,
} from '@/lib/guild/agents/analyst';

/**
 * Phase 2 Commit 6 / 7 — shared analyst report generator.
 *
 * Extracted from /api/guild/agents/analyst so the weekly cron
 * (/api/cron/analyst-weekly-generate) can call the same Claude path
 * without duplicating prompt construction or shape validation.
 *
 * Storage shape per pre-flight D2:
 *   guild_agent_context.agent_name = 'analyst'
 *   context jsonb:
 *     {
 *       reports: { YYYY-MM-DD: AnalystReport, ... }   // legacy daily cache
 *       weekly_report: {                               // new weekly cadence
 *         cadence: 'weekly',
 *         generated_at: ISO timestamp,
 *         week_starting: YYYY-MM-DD (Monday),
 *         week_ending:   YYYY-MM-DD (Sunday),
 *         report: AnalystReport,
 *         metrics: {
 *           new_referrals, new_commissions_usd, funnel_conversion_pct
 *         },
 *         next_cadence_run_at: ISO timestamp
 *       }
 *       last_series: TimeseriesPoint[]                 // unchanged
 *     }
 *
 * The weekly_report is an ADDITIVE key — legacy daily cache continues
 * to populate from the on-demand POST path, and the UI refactor in
 * Commit 7 reads weekly_report first with daily-cache as a fallback.
 * Non-breaking.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface WeeklyReportEnvelope {
  cadence: 'weekly';
  generated_at: string;
  week_starting: string;
  week_ending: string;
  report: AnalystReport;
  metrics: {
    new_referrals: number;
    new_commissions_usd: number;
    funnel_conversion_pct: number | null;
  };
  next_cadence_run_at: string;
}

/**
 * Generate an analyst report scoped to the last 7 days for one member.
 * Writes the result into guild_agent_context.context.weekly_report.
 *
 * Returns the envelope that was persisted, or null on transient failure.
 * Callers (the cron) should log failures but not abort the whole batch.
 */
export async function generateWeeklyAnalystReport(
  admin: SupabaseClient,
  member: GuildMemberCtx,
): Promise<WeeklyReportEnvelope | null> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Current week's Monday (00:00 UTC) and the Sunday that ends it.
  const weekStart = mondayOf(nowIso);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  // Next Monday 06:00 UTC — the schedule the cron runs on.
  const nextMonday = new Date(weekStart);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  nextMonday.setUTCHours(6, 0, 0, 0);

  try {
    const metrics = await loadReferralMetrics(admin, member);

    // 12-week timeseries so the prompt has context for comparison; the
    // weekly report focuses on the last 7 days but benefits from trend
    // context.
    const series = await loadWeeklyTimeseriesForAnalyst(admin, member, 12);

    const prompt = buildAnalystPrompt(member, metrics, series);

    const response = await anthropic.messages.create({
      model: modelFor('guild_analyst_report'),
      max_tokens: maxTokensFor('guild_analyst_report'),
      system:
        'You are a structured-output assistant. Respond with ONLY valid JSON. No prose, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    // Best-effort cost log. This runs from the Monday 06:00 UTC cron
    // across every active Guild member, so the CFO Agent will see a
    // clear weekly burst in guild_analyst_report spend. `source: 'cron'`
    // distinguishes it from on-demand reports from the route.
    void logGuildAgentUsage(admin, {
      userId: member.user_id,
      memberId: member.id,
      task: 'guild_analyst_report',
      usage: response.usage,
      metadata: {
        source: 'cron',
        cadence: 'weekly',
        week_starting: weekStart,
      },
    });

    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();

    const report: AnalystReport = JSON.parse(cleaned);

    if (
      !report.headline ||
      !report.momentum ||
      !Array.isArray(report.what_is_working) ||
      !Array.isArray(report.what_is_not) ||
      !Array.isArray(report.watch_next)
    ) {
      console.error(
        '[generateWeeklyAnalystReport] malformed report for member',
        member.id,
      );
      return null;
    }

    // Derive top-level summary metrics from the latest bucket. The report
    // itself has qualitative findings; these three numbers are the
    // quantitative headline that the UI shows alongside "Last updated …".
    const lastWeekBucket = series[series.length - 1];
    const weeklyMetrics = {
      new_referrals: lastWeekBucket?.signups ?? 0,
      new_commissions_usd: lastWeekBucket?.commission_usd ?? 0,
      funnel_conversion_pct:
        lastWeekBucket && lastWeekBucket.signups > 0
          ? Number(
              ((lastWeekBucket.first_payments / lastWeekBucket.signups) * 100).toFixed(1),
            )
          : null,
    };

    const envelope: WeeklyReportEnvelope = {
      cadence: 'weekly',
      generated_at: nowIso,
      week_starting: weekStart,
      week_ending: weekEndIso,
      report,
      metrics: weeklyMetrics,
      next_cadence_run_at: nextMonday.toISOString(),
    };

    // UPSERT into guild_agent_context preserving existing keys (reports
    // map, last_series). Read current context, merge, write.
    const current = await getAgentContext<{
      reports?: Record<string, AnalystReport>;
      weekly_report?: WeeklyReportEnvelope;
      last_series?: TimeseriesPoint[];
    }>(admin, member.id, 'analyst');

    await setAgentContext(admin, member.id, 'analyst', {
      ...current,
      weekly_report: envelope,
      last_series: series,
    });

    return envelope;
  } catch (err: any) {
    console.error(
      '[generateWeeklyAnalystReport] error for member',
      member.id,
      err?.message || err,
    );
    return null;
  }
}

/**
 * Monday-of helper duplicated from the route file so this lib doesn't
 * need to import the route module. Keeping the helpers co-located.
 */
function mondayOf(iso: string): string {
  const d = new Date(iso);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds N weeks of buckets from guild_referrals + guild_commissions.
 * Identical to loadWeeklyTimeseries in the analyst route — factored
 * here so the cron and the route can share. Keeping a thin re-export
 * alias so the existing route doesn't need an import graph change
 * (Commit 7 handles the route refactor).
 */
export async function loadWeeklyTimeseriesForAnalyst(
  admin: SupabaseClient,
  member: GuildMemberCtx,
  weeks: number,
): Promise<TimeseriesPoint[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const [{ data: refs }, { data: comms }] = await Promise.all([
    admin
      .from('guild_referrals')
      .select('created_at, first_paid_at')
      .eq('guildmember_id', member.id)
      .gte('created_at', cutoffIso),
    admin
      .from('guild_commissions')
      .select('commission_amount_usd, earned_at, status')
      .eq('guildmember_id', member.id)
      .gte('earned_at', cutoffIso),
  ]);

  const buckets = new Map<
    string,
    { signups: number; first_payments: number; commission_usd: number }
  >();
  for (let i = 0; i < weeks; i++) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + mondayOffset - i * 7);
    buckets.set(d.toISOString().slice(0, 10), {
      signups: 0,
      first_payments: 0,
      commission_usd: 0,
    });
  }

  for (const r of refs ?? []) {
    const k = mondayOf(r.created_at);
    const b = buckets.get(k);
    if (b) b.signups += 1;
    if (r.first_paid_at) {
      const k2 = mondayOf(r.first_paid_at);
      const b2 = buckets.get(k2);
      if (b2) b2.first_payments += 1;
    }
  }
  for (const c of comms ?? []) {
    if (c.status === 'clawed_back') continue;
    const k = mondayOf(c.earned_at);
    const b = buckets.get(k);
    if (b) b.commission_usd += Number(c.commission_amount_usd);
  }

  return Array.from(buckets.entries())
    .map(([week_start, v]) => ({
      week_start,
      signups: v.signups,
      first_payments: v.first_payments,
      commission_usd: Number(v.commission_usd.toFixed(2)),
    }))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
}
