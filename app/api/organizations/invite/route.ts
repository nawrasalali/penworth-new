import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orgId, email, role } = body;

    if (!orgId || !email || !role) {
      return NextResponse.json(
        { error: 'orgId, email, and role are required' },
        { status: 400 }
      );
    }

    // Verify user is admin/owner of the organization
    const { data: membership, error: memberError } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can invite members' },
        { status: 403 }
      );
    }

    // Check if user is already a member
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      // Check if already a member
      const { data: existingMember } = await supabase
        .from('org_members')
        .select('id')
        .eq('org_id', orgId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this organization' },
          { status: 400 }
        );
      }

      // Add existing user to organization
      const { error: addError } = await supabase.from('org_members').insert({
        org_id: orgId,
        user_id: existingUser.id,
        role,
      });

      if (addError) {
        throw addError;
      }

      return NextResponse.json({
        success: true,
        message: 'User added to organization',
        added: true,
      });
    }

    // User doesn't exist - create invitation record and send email
    // For now, store invitation in a simple format
    // In production, you'd want an invitations table

    // Get organization details
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    // Send invitation email using Resend (or configured email service)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://penworth.ai';
    const inviteToken = Buffer.from(JSON.stringify({
      orgId,
      email,
      role,
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })).toString('base64url');

    const inviteLink = `${appUrl}/invite/${inviteToken}`;

    // In production, send actual email
    // For now, just return success
    console.log('Invitation link:', inviteLink);

    // Try to send email if Resend is configured
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
          from: 'Penworth <support@penworth.ai>',
          to: email,
          bcc: ['nawras@penworth.ai'],
          replyTo: 'support@penworth.ai',
          subject: `You're invited to join ${org?.name || 'an organization'} on Penworth`,
          html: `
            <h2>You've been invited!</h2>
            <p>You've been invited to join <strong>${org?.name || 'an organization'}</strong> on Penworth as a ${role}.</p>
            <p><a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background: #1B3A57; color: white; text-decoration: none; border-radius: 6px;">Accept Invitation</a></p>
            <p>This invitation expires in 7 days.</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
          `,
        });
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        // Don't fail the request - invitation is still valid
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Invitation sent',
      invitePending: true,
    });

  } catch (error) {
    console.error('Invite error:', error);
    return NextResponse.json(
      { error: 'Failed to send invitation' },
      { status: 500 }
    );
  }
}
