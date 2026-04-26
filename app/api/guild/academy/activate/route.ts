import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { triggerActivationIfEligible } from '@/lib/academy/activation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/academy/activate
 *
 * Manual / retry trigger for the activation flow. Idempotent — safe to call
 * multiple times. Returns the same shape as the inline trigger fired from
 * /api/guild/academy/complete.
 *
 * Usage:
 *   - Member sees a stuck "passed all three but no certificate" state and
 *     hits the retry button on the dashboard.
 *   - Admin re-triggers activation for a member after fixing a downstream
 *     issue (e.g. display_name was missing, now set).
 *   - Backfill script for members who passed quizzes before this code shipped.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = createServiceClient();
    const { data: member } = await admin
      .from('guild_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });

    const result = await triggerActivationIfEligible(member.id, admin);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[academy/activate] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
