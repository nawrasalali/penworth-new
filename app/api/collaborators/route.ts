import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nanoid } from 'nanoid';

// Generate a unique invite token
function generateInviteToken(): string {
  return nanoid(32);
}

// GET: Get collaborators for a project
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = request.nextUrl.searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Verify user owns the project
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();

    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get collaborators
    const { data: collaborators, error } = await supabase
      .from('collaborators')
      .select(`
        *,
        invitee:invitee_id (
          full_name,
          avatar_url
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

    return NextResponse.json({
      collaborators: collaborators?.map(c => ({
        id: c.id,
        email: c.invitee_email,
        role: c.role,
        status: c.status,
        inviteLink: c.status === 'pending' ? `${appUrl}/invite/${c.invite_token}` : null,
        acceptedAt: c.accepted_at,
        createdAt: c.created_at,
        invitee: c.invitee ? {
          name: (c.invitee as any).full_name,
          avatar: (c.invitee as any).avatar_url,
        } : null,
      })) || [],
    });
  } catch (error) {
    console.error('Get collaborators error:', error);
    return NextResponse.json(
      { error: 'Failed to get collaborators' },
      { status: 500 }
    );
  }
}

// POST: Invite a collaborator
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, email, role = 'reviewer' } = body;

    if (!projectId || !email) {
      return NextResponse.json({ error: 'Project ID and email required' }, { status: 400 });
    }

    if (!['reviewer', 'editor'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Verify user owns the project
    const { data: project } = await supabase
      .from('projects')
      .select('id, title, user_id')
      .eq('id', projectId)
      .single();

    if (!project || project.user_id !== user.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Can't invite yourself
    if (email.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot invite yourself' }, { status: 400 });
    }

    // Check if already invited
    const { data: existing } = await supabase
      .from('collaborators')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('invitee_email', email.toLowerCase())
      .single();

    if (existing) {
      return NextResponse.json({ 
        error: existing.status === 'pending' 
          ? 'Invitation already sent' 
          : 'This person is already a collaborator' 
      }, { status: 400 });
    }

    // Check if invitee already has an account
    const { data: inviteeProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    // Create invitation
    const inviteToken = generateInviteToken();
    const { data: collaborator, error } = await supabase
      .from('collaborators')
      .insert({
        project_id: projectId,
        inviter_id: user.id,
        invitee_email: email.toLowerCase(),
        invitee_id: inviteeProfile?.id || null,
        role,
        invite_token: inviteToken,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';
    const inviteLink = `${appUrl}/invite/${inviteToken}`;

    // TODO: Send email invitation via Resend
    // For now, just return the link

    return NextResponse.json({
      success: true,
      collaborator: {
        id: collaborator.id,
        email: collaborator.invitee_email,
        role: collaborator.role,
        status: collaborator.status,
        inviteLink,
      },
      message: `Invitation sent to ${email}`,
    });
  } catch (error) {
    console.error('Invite collaborator error:', error);
    return NextResponse.json(
      { error: 'Failed to invite collaborator' },
      { status: 500 }
    );
  }
}

// DELETE: Remove a collaborator
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const collaboratorId = request.nextUrl.searchParams.get('id');

    if (!collaboratorId) {
      return NextResponse.json({ error: 'Collaborator ID required' }, { status: 400 });
    }

    // Verify user owns the project
    const { data: collaborator } = await supabase
      .from('collaborators')
      .select('id, inviter_id')
      .eq('id', collaboratorId)
      .single();

    if (!collaborator || collaborator.inviter_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Delete the collaborator
    const { error } = await supabase
      .from('collaborators')
      .delete()
      .eq('id', collaboratorId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete collaborator error:', error);
    return NextResponse.json(
      { error: 'Failed to remove collaborator' },
      { status: 500 }
    );
  }
}
