import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { QuizPayload } from '@/lib/academy/quiz';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  return idx === -1 ? 0 : idx;
}

/**
 * POST /api/guild/academy/checkpoint
 * Body: { module_id, after_segment, selected_index }
 *
 * Engagement-only mid-course check used to gate forward progression in the
 * player. Does NOT count toward the end-of-course quiz score, does NOT
 * decrement attempts, and does NOT write to guild_academy_progress.
 *
 * Returns whether the answer was correct, the correct_index, and the wrong-
 * answer voice explanation so the UI can play the matching audio clip and
 * reveal the right answer when the member misses.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const moduleId = body?.module_id as string | undefined;
    const afterSegment = body?.after_segment as number | undefined;
    const selectedIndex = body?.selected_index as number | undefined;

    if (!moduleId || typeof moduleId !== 'string') {
      return NextResponse.json({ error: 'module_id is required' }, { status: 400 });
    }
    if (typeof afterSegment !== 'number') {
      return NextResponse.json({ error: 'after_segment is required' }, { status: 400 });
    }
    if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex > 3) {
      return NextResponse.json({ error: 'selected_index must be 0-3' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = createServiceClient();

    const { data: member } = await admin
      .from('guild_members')
      .select('id, tier')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });

    const { data: module } = await admin
      .from('guild_academy_modules')
      .select('id, slug, category, required_tier, quiz')
      .eq('id', moduleId)
      .maybeSingle();
    if (!module) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    if (module.category !== 'mandatory' && module.required_tier) {
      if (tierRank(member.tier) < tierRank(module.required_tier)) {
        return NextResponse.json({ error: 'Module locked for your tier' }, { status: 403 });
      }
    }

    const quiz = module.quiz as QuizPayload | null;
    const checkpoint = quiz?.checkpoints?.find((c) => c.after_segment === afterSegment);
    if (!checkpoint) {
      return NextResponse.json({ error: `No checkpoint after segment ${afterSegment}` }, { status: 404 });
    }

    const correct = selectedIndex === checkpoint.correct_index;

    return NextResponse.json({
      correct,
      correct_index: checkpoint.correct_index,
      explanation: correct ? null : checkpoint.explanation,
      voice: checkpoint.voice,
    });
  } catch (e: any) {
    console.error('[academy/checkpoint] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
