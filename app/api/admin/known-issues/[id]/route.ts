import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/admin/require-admin';
import { validateKnownIssuePayload } from '@/lib/admin/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/known-issues/[id] — update an existing pattern.
 *
 * Pattern_slug is treated as immutable (form disables the input in
 * edit mode). Everything else is updatable. Does NOT touch match_count,
 * last_matched_at, or resolution_success_rate — those are maintained
 * by Nora's matcher when it ships.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateKnownIssuePayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from('nora_known_issues')
    .update({
      title: body.title.trim(),
      surface: body.surface === 'all' ? null : body.surface || null,
      symptom_keywords: body.symptom_keywords ?? [],
      diagnostic_sql: body.diagnostic_sql ?? null,
      resolution_playbook: body.resolution_playbook ?? null,
      auto_fix_tool: body.auto_fix_tool ?? null,
      auto_fix_tier: body.auto_fix_tier ?? null,
      escalate_after_attempts: body.escalate_after_attempts ?? 2,
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23514') {
      return NextResponse.json(
        { error: `Check constraint violated: ${error.message}` },
        { status: 400 },
      );
    }
    console.error('[PATCH /api/admin/known-issues/:id] update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
  }

  return NextResponse.json({ data });
}
