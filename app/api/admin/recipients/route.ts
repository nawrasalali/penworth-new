import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest } from '@/lib/audit';
import {
  ALLOWED_CATEGORIES,
  validateRecipientPayload,
  type RecipientWriteInput,
} from '@/lib/admin/recipients-validation';

export const runtime = 'nodejs';

/**
 * /api/admin/recipients
 *
 * GET  — list every recipient, active or not, ordered by active desc,
 *        email asc. Super-admin only. Non-super-admin hits from anywhere
 *        in the app get 404 (requireAdminRoleForApi returns that, not
 *        403 — consistent with how /admin/command-center treats probers).
 * POST — create a new recipient. Validation in the shared helper so the
 *        PATCH route can reuse it.
 *
 * Audit: every mutation lands an audit_log row with action 'admin.override',
 * entityType 'alert_recipient', before/after on changed fields only, and
 * severity 'warning' — recipient changes affect who gets paged on P0.
 */

export async function GET(request: NextRequest) {
  const gate = await requireAdminRoleForApi('super_admin');
  if (!gate.ok) return gate.response;

  const admin = createServiceClient();
  const { data, error } = await admin
    .from('alert_recipients')
    .select(
      'id, email, full_name, receives_p0, receives_p1, receives_p2, categories, quiet_hours_start, quiet_hours_end, timezone, active, created_at',
    )
    .order('active', { ascending: false })
    .order('email', { ascending: true });

  if (error) {
    console.error('[api/admin/recipients GET] list failed:', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }

  return NextResponse.json({ recipients: data ?? [], allowedCategories: ALLOWED_CATEGORIES });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminRoleForApi('super_admin');
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validation = validateRecipientPayload(raw, { mode: 'create' });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.code, message: validation.message, field: validation.field },
      { status: 400 },
    );
  }

  const payload = validation.value as RecipientWriteInput;

  const admin = createServiceClient();
  const { data: inserted, error } = await admin
    .from('alert_recipients')
    .insert({
      email: payload.email,
      full_name: payload.full_name ?? null,
      receives_p0: payload.receives_p0,
      receives_p1: payload.receives_p1,
      receives_p2: payload.receives_p2,
      categories: payload.categories,
      quiet_hours_start: payload.quiet_hours_start,
      quiet_hours_end: payload.quiet_hours_end,
      timezone: payload.timezone,
      active: payload.active ?? true,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    // 23505 (unique_violation) lands here if email is duplicated — the
    // live schema doesn't declare a UNIQUE on email today, but if one
    // is added later this error mapping keeps working.
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'duplicate_email', message: 'A recipient with this email already exists.' },
        { status: 409 },
      );
    }
    console.error('[api/admin/recipients POST] insert failed:', error);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: gate.userId,
    action: 'admin.override',
    entityType: 'alert_recipient',
    entityId: inserted.id,
    before: null,
    after: {
      email: payload.email,
      full_name: payload.full_name ?? null,
      receives_p0: payload.receives_p0,
      receives_p1: payload.receives_p1,
      receives_p2: payload.receives_p2,
      categories: payload.categories,
      quiet_hours_start: payload.quiet_hours_start,
      quiet_hours_end: payload.quiet_hours_end,
      timezone: payload.timezone,
      active: payload.active ?? true,
    },
    metadata: { route: '/api/admin/recipients', method: 'POST' },
    severity: 'warning',
  });

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
