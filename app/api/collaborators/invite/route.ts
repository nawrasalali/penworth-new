import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/collaborators/invite?token=xxx - Get invite details by token
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Find invite by token
    const { data: invite, error } = await supabase
      .from('collaborators')
      .select(`
        id,
        role,
        status,
        permissions,
        project_id,
        projects (title),
        profiles:owner_id (full_name)
      `)
      .eq('invite_token', token)
      .single();

    if (error || !invite) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'This invitation has already been used or expired' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      invite: {
        id: invite.id,
        projectTitle: (invite.projects as any)?.title || 'Untitled',
        ownerName: (invite.profiles as any)?.full_name || 'Someone',
        role: invite.role,
        permissions: invite.permissions,
      },
    });

  } catch (error) {
    console.error('Get invite error:', error);
    return NextResponse.json(
      { error: 'Failed to get invitation' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/collaborators/invite - Accept or decline an invite
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const body = await request.json();
    const { token, action } = body;

    if (!token || !action) {
      return NextResponse.json(
        { error: 'Token and action are required' },
        { status: 400 }
      );
    }

    if (!['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Find invite
    const { data: invite, error: inviteError } = await supabase
      .from('collaborators')
      .select('id, status, email, project_id')
      .eq('invite_token', token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'This invitation has already been processed' },
        { status: 400 }
      );
    }

    // For declining, user doesn't need to be logged in
    if (action === 'decline') {
      await supabase
        .from('collaborators')
        .update({ status: 'declined' })
        .eq('id', invite.id);

      return NextResponse.json({ success: true });
    }

    // For accepting, user must be logged in
    if (!user) {
      return NextResponse.json(
        { error: 'You must be logged in to accept this invitation' },
        { status: 401 }
      );
    }

    // Accept the invite
    const { error: updateError } = await supabase
      .from('collaborators')
      .update({
        status: 'accepted',
        collaborator_id: user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      projectId: invite.project_id,
    });

  } catch (error) {
    console.error('Process invite error:', error);
    return NextResponse.json(
      { error: 'Failed to process invitation' },
      { status: 500 }
    );
  }
}
