import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/publishing/computer/session/[sessionId]/resolve
 * body: { response: string } | { cancel: true }
 *
 * Delivers a 2FA code (or any text answer) to a paused agent loop, or
 * cancels the session entirely. We look up the in-memory control handle
 * from the stream route's registry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify ownership first
  const { data: session } = await supabase
    .from('computer_use_sessions')
    .select('id, status')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { response, cancel } = body as { response?: string; cancel?: boolean };

  // Grab the in-memory handle. If we can't find it, the session is running
  // on a different node or already ended; fail soft.
  type Ctl = { cancel: () => void; resolveHandoff: (t: string) => void };
  const registry = (globalThis as unknown as {
    __penworthComputerControls?: Map<string, Ctl>;
  }).__penworthComputerControls;
  const ctl = registry?.get(sessionId);

  if (cancel) {
    if (ctl) ctl.cancel();
    // Always flip DB status to cancelled — stream will finalise when it notices
    const service = createServiceClient();
    await service
      .from('computer_use_sessions')
      .update({ status: 'cancelled', ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    return NextResponse.json({ ok: true, cancelled: true });
  }

  if (typeof response !== 'string' || !response.trim()) {
    return NextResponse.json({ error: 'response required' }, { status: 400 });
  }

  if (!ctl) {
    return NextResponse.json(
      { error: 'Session not active on this node (or already finished)' },
      { status: 410 },
    );
  }
  ctl.resolveHandoff(response.trim());

  // Flip state back to running
  const service = createServiceClient();
  await service
    .from('computer_use_sessions')
    .update({
      status: 'running',
      two_factor_request: null,
      reason_for_pause: null,
    })
    .eq('id', sessionId);

  return NextResponse.json({ ok: true });
}
