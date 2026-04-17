import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * GET /api/collaborators?projectId=xxx - Get collaborators for a project
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Verify user owns the project or is a collaborator
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id, title')
      .eq('id', projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const isOwner = project.user_id === user.id;

    if (!isOwner) {
      // Check if user is a collaborator
      const { data: collab } = await supabase
        .from('collaborators')
        .select('id')
        .eq('project_id', projectId)
        .eq('collaborator_id', user.id)
        .eq('status', 'accepted')
        .single();

      if (!collab) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Get all collaborators
    const { data: collaborators, error } = await supabase
      .from('collaborators')
      .select(`
        id,
        email,
        role,
        status,
        permissions,
        invite_sent_at,
        accepted_at,
        collaborator_id,
        profiles:collaborator_id (full_name, avatar_url)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      projectId,
      isOwner,
      collaborators: collaborators?.map(c => ({
        id: c.id,
        email: c.email,
        role: c.role,
        status: c.status,
        permissions: c.permissions,
        inviteSentAt: c.invite_sent_at,
        acceptedAt: c.accepted_at,
        name: (c.profiles as any)?.full_name || null,
        avatar: (c.profiles as any)?.avatar_url || null,
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

/**
 * POST /api/collaborators - Invite a collaborator
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, email, role = 'reviewer', permissions } = body;

    if (!projectId || !email) {
      return NextResponse.json(
        { error: 'projectId and email are required' },
        { status: 400 }
      );
    }

    // Verify user owns the project
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id, title')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
    }

    // Check if already invited
    const { data: existing } = await supabase
      .from('collaborators')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      if (existing.status === 'pending') {
        return NextResponse.json(
          { error: 'This person has already been invited' },
          { status: 400 }
        );
      }
      if (existing.status === 'accepted') {
        return NextResponse.json(
          { error: 'This person is already a collaborator' },
          { status: 400 }
        );
      }
    }

    // Generate invite token
    const inviteToken = generateToken();

    // Check if invitee already has an account
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    // Create collaborator record
    const { data: collaborator, error: insertError } = await supabase
      .from('collaborators')
      .insert({
        project_id: projectId,
        owner_id: user.id,
        collaborator_id: existingUser?.id || null,
        email: email.toLowerCase(),
        role,
        invite_token: inviteToken,
        permissions: permissions || {
          can_comment: true,
          can_edit: role === 'editor' || role === 'co_author',
          can_export: role === 'co_author',
        },
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Get owner name
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const ownerName = ownerProfile?.full_name || 'Someone';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';
    const inviteUrl = `${appUrl}/invite/${inviteToken}`;

    // Send invite email
    try {
      await resend.emails.send({
        from: 'Penworth <support@penworth.ai>',
        to: email,
        bcc: ['nawras@penworth.ai'],
        replyTo: 'support@penworth.ai',
        subject: `${ownerName} invited you to collaborate on "${project.title}"`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1B3A57;">You're Invited to Collaborate!</h1>
            <p><strong>${ownerName}</strong> has invited you to be a <strong>${role}</strong> on their book:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="margin: 0 0 10px;">${project.title}</h2>
              <p style="color: #666; margin: 0;">Role: ${role.charAt(0).toUpperCase() + role.slice(1).replace('_', ' ')}</p>
            </div>
            <a href="${inviteUrl}" style="display: inline-block; background: #1B3A57; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
              Accept Invitation
            </a>
            <p style="color: #666; margin-top: 30px; font-size: 14px;">
              Or copy this link: ${inviteUrl}
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #999; font-size: 12px;">
              This invitation was sent by Penworth. If you don't know ${ownerName}, you can ignore this email.
            </p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send invite email:', emailError);
      // Don't fail the invite if email fails
    }

    return NextResponse.json({
      success: true,
      collaborator: {
        id: collaborator.id,
        email: collaborator.email,
        role: collaborator.role,
        status: collaborator.status,
        inviteUrl,
      },
    });

  } catch (error) {
    console.error('Invite collaborator error:', error);
    return NextResponse.json(
      { error: 'Failed to invite collaborator' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/collaborators?id=xxx - Remove a collaborator
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const collaboratorId = searchParams.get('id');

    if (!collaboratorId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Verify user owns the project
    const { data: collab } = await supabase
      .from('collaborators')
      .select('id, owner_id')
      .eq('id', collaboratorId)
      .single();

    if (!collab || collab.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Delete collaborator
    await supabase
      .from('collaborators')
      .delete()
      .eq('id', collaboratorId);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Remove collaborator error:', error);
    return NextResponse.json(
      { error: 'Failed to remove collaborator' },
      { status: 500 }
    );
  }
}

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
