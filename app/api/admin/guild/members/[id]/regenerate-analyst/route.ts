import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { generateWeeklyAnalystReport } from '@/lib/guild/agents/analyst-generator';
import type { GuildMemberCtx } from '@/lib/guild/agents/shared';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/guild/members/[id]/regenerate-analyst
 *
 * Admin-only one-shot regeneration of a single member's weekly analyst
 * report. Bypasses the Monday cron schedule — useful when an admin is
 * investigating a member's account and wants a fresh Claude read on the
 * latest numbers.
 *
 * Doesn't touch the legacy daily-cache map (context.reports). Only
 * refreshes context.weekly_report per the D2 storage shape.
 */
export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id: memberId } = await ctx.params;
  const admin = createAdminClient();

  const { data: member, error } = await admin
    .from('guild_members')
    .select(
      'id, user_id, display_name, tier, status, primary_market, primary_language, joined_at, referral_code',
    )
    .eq('id', memberId)
    .maybeSingle();

  if (error) {
    console.error('[regenerate-analyst] fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const envelope = await generateWeeklyAnalystReport(admin, member as GuildMemberCtx);
  if (!envelope) {
    return NextResponse.json(
      { error: 'Report generation failed — see server logs' },
      { status: 502 },
    );
  }

  return NextResponse.json({ data: envelope });
}
