import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/projects - List user's projects
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('projects')
      .select('*, organizations(name, industry)', { count: 'exact' })
      .or(`user_id.eq.${user.id},org_id.in.(select org_id from org_members where user_id = '${user.id}')`)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (type) {
      query = query.eq('content_type', type);
    }

    const { data: projects, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: projects,
      total: count,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Projects GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, content_type, visibility, org_id } = body;

    if (!title || !content_type) {
      return NextResponse.json(
        { error: 'Title and content_type are required' },
        { status: 400 }
      );
    }

    // If org_id provided, verify user is a member
    if (org_id) {
      const { data: membership } = await supabase
        .from('org_members')
        .select('role')
        .eq('org_id', org_id)
        .eq('user_id', user.id)
        .single();

      if (!membership || !['owner', 'admin', 'editor'].includes(membership.role)) {
        return NextResponse.json(
          { error: 'You do not have permission to create projects in this organization' },
          { status: 403 }
        );
      }
    }

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        org_id: org_id || null,
        title,
        description: description || null,
        content_type,
        visibility: visibility || 'private',
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Phase 1E: attempt to consume a Guild showcase grant for this project.
    // The RPC is atomic and returns {consumed: true, grant_id, category}
    // on success or {consumed: false, reason} on any non-applicable state
    // (not a member, wrong status, content_type not mapped, no unused grant
    // for that category). Uses FOR UPDATE SKIP LOCKED internally so two
    // simultaneous project creations for the same category cannot both win.
    //
    // On consume: UPDATE the project row to tag it billing_type='showcase_grant'
    // so downstream generation/regen/publishing skip credit deduction via the
    // shouldDeductCreditsForProject helper. The helper is self-healing — if
    // this UPDATE fails between the consume and the return, the helper's
    // second branch (EXISTS guild_showcase_grants status='used') still causes
    // downstream deduction to be skipped. See migration 014 for the RPC body.
    const admin = createAdminClient();
    const { data: grantResult, error: grantErr } = await admin.rpc(
      'guild_consume_showcase_grant',
      {
        p_user_id: user.id,
        p_content_type: project.content_type,
        p_project_id: project.id,
      },
    );

    if (grantErr) {
      // Non-fatal: the project exists, the user just didn't get a grant.
      // Log loudly so we notice if the RPC is failing systematically.
      console.error(
        '[projects/POST] guild_consume_showcase_grant RPC error (non-fatal):',
        { projectId: project.id, userId: user.id, error: grantErr },
      );
    }

    // jsonb return type — TS sees any; use defensive checks.
    const grant = (grantResult as { consumed?: boolean; grant_id?: string } | null) || null;
    let projectOut = project;

    if (grant?.consumed && grant.grant_id) {
      const { data: updated, error: tagErr } = await admin
        .from('projects')
        .update({
          billing_type: 'showcase_grant',
          grant_id: grant.grant_id,
        })
        .eq('id', project.id)
        .select()
        .single();

      if (tagErr) {
        // The grant is consumed (guild_showcase_grants.status='used' with
        // project_id set), but we failed to tag the project. The helper's
        // self-healing branch will still cause downstream credits to be
        // skipped, so this is non-fatal — but log it so we can reconcile.
        console.error(
          '[projects/POST] Failed to tag project as grant-billed (self-healing fallback will cover):',
          { projectId: project.id, grantId: grant.grant_id, error: tagErr },
        );
      } else if (updated) {
        projectOut = updated;
      }
    }

    return NextResponse.json({ data: projectOut }, { status: 201 });
  } catch (error) {
    console.error('Projects POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
