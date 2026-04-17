import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Soft-delete, restore, or permanently delete a project.
 *
 * POST /api/projects/[id]/trash     -> action: 'soft_delete' | 'restore' | 'permanent_delete'
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const { action } = await request.json();

  // Verify ownership
  const { data: project, error: loadErr } = await supabase
    .from('projects')
    .select('id, user_id, deleted_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (loadErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  switch (action) {
    case 'soft_delete': {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, state: 'trashed' });
    }

    case 'restore': {
      const { error } = await supabase
        .from('projects')
        .update({ deleted_at: null })
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, state: 'active' });
    }

    case 'permanent_delete': {
      // Must already be trashed
      if (!project.deleted_at) {
        return NextResponse.json(
          { error: 'Move to recycle bin first before permanent delete.' },
          { status: 400 },
        );
      }
      // chapters / interview_sessions / project_publications / marketplace_listings
      // all have ON DELETE CASCADE (or are cleaned up by this endpoint) — verify
      // the cascade by attempting the delete; if a FK blocks it, we return the error.
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, state: 'destroyed' });
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
