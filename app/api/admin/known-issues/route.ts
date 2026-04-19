import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/admin/require-admin';
import { validateKnownIssuePayload } from '@/lib/admin/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/known-issues — create a new pattern.
 *
 * Validation lives in validateKnownIssuePayload for reuse by the PATCH
 * route. auto_fix_tier must be 1/2/3 if auto_fix_tool is set.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

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
    .insert({
      pattern_slug: body.pattern_slug.trim(),
      title: body.title.trim(),
      surface: body.surface === 'all' ? null : body.surface || null,
      symptom_keywords: body.symptom_keywords ?? [],
      diagnostic_sql: body.diagnostic_sql ?? null,
      resolution_playbook: body.resolution_playbook ?? null,
      auto_fix_tool: body.auto_fix_tool ?? null,
      auto_fix_tier: body.auto_fix_tier ?? null,
      escalate_after_attempts: body.escalate_after_attempts ?? 2,
      active: body.active !== false,
    })
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A pattern with that slug already exists' },
        { status: 409 },
      );
    }
    if (error.code === '23514') {
      return NextResponse.json(
        { error: `Check constraint violated: ${error.message}` },
        { status: 400 },
      );
    }
    console.error('[POST /api/admin/known-issues] insert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
