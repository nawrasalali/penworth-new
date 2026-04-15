import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    return NextResponse.json({ data: project }, { status: 201 });
  } catch (error) {
    console.error('Projects POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
