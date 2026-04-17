import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/status
 * Look up the latest application for an email. Used by the public status page.
 * Returns minimal data: status, created_at. Does NOT return scores or flags.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('guild_applications')
      .select('id, application_status, created_at, decided_at')
      .eq('email', email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[guild/status] Query error:', error);
      return NextResponse.json({ error: 'Unable to look up application.' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({
        found: false,
      });
    }

    return NextResponse.json({
      found: true,
      id: data.id,
      status: data.application_status,
      submitted_at: data.created_at,
      decided_at: data.decided_at,
    });
  } catch (err) {
    console.error('[guild/status] Unexpected error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
