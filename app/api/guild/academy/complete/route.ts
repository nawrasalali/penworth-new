import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'];

function tierRank(tier: string | null | undefined): number {
  if (!tier) return 0;
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? 0 : idx;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { module_id, quiz_score } = body as {
      module_id?: string;
      quiz_score?: number;
    };

    if (!module_id || typeof module_id !== 'string') {
      return NextResponse.json({ error: 'module_id is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const admin = createServiceClient();

    const { data: member } = await admin
      .from('guild_members')
      .select('id, tier')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) {
      return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });
    }

    const { data: module } = await admin
      .from('guild_academy_modules')
      .select('id, is_mandatory, required_tier, quiz')
      .eq('id', module_id)
      .maybeSingle();
    if (!module) {
      return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    }

    // Tier gate for electives
    if (!module.is_mandatory && module.required_tier) {
      if (tierRank(member.tier) < tierRank(module.required_tier)) {
        return NextResponse.json({ error: 'Module locked for your tier' }, { status: 403 });
      }
    }

    // If module has a quiz, server-side verify the score meets threshold
    const quiz = module.quiz as {
      questions?: { correct_index: number }[];
      pass_threshold?: number;
    } | null;

    if (quiz && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
      const threshold = quiz.pass_threshold ?? quiz.questions.length;
      if (typeof quiz_score !== 'number' || quiz_score < threshold) {
        return NextResponse.json(
          { error: 'Quiz score does not meet threshold' },
          { status: 400 },
        );
      }
    }

    // Upsert progress row — unique on (guildmember_id, module_id)
    const { error: upsertErr } = await admin
      .from('guild_academy_progress')
      .upsert(
        {
          guildmember_id: member.id,
          module_id,
          completed_at: new Date().toISOString(),
          quiz_score: typeof quiz_score === 'number' ? quiz_score : null,
        },
        { onConflict: 'guildmember_id,module_id' },
      );

    if (upsertErr) {
      console.error('[academy/complete] upsert error', upsertErr);
      return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[academy/complete] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
