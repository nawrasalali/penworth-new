import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest } from '@/lib/audit';
import { validateRecipientPayload, type RecipientPatchInput } from '@/lib/admin/recipients-validation';

export const runtime = 'nodejs';

/**
 * /api/admin/recipients/[id]
 *
 * PATCH  — partial update. Validates only the fields supplied. At least
 *          one of receives_p0/receives_p1/receives_p2 must remain true
 *          after the update (post-merge check). Audit row captures
 *          before/after on changed fields only.
 * DELETE — soft delete (sets active=false). Row remains in DB for
 *          audit trail; alert dispatch filters on active=true.
 */

type RouteContext = { params: Promise<{ id: string }> };

// Columns we load as the "before" snapshot and as the row we update.
const RECIPIENT_COLUMNS =
  'id, email, full_name, receives_p0, receives_p1, receives_p2, categories, quiet_hours_start, quiet_hours_end, timezone, active';

type RecipientRow = {
  id: string;
  email: string;
  full_name: string | null;
  receives_p0: boolean;
  receives_p1: boolean;
  receives_p2: boolean;
  categories: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  active: boolean;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const gate = await requireAdminRoleForApi('super_admin');
  if (!gate.ok) return gate.response;

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const validation = validateRecipientPayload(raw, { mode: 'patch' });
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.code, message: validation.message, field: validation.field },
      { status: 400 },
    );
  }

  const patch = validation.value as RecipientPatchInput;

  const admin = createServiceClient();
  const { data: before, error: fetchErr } = await admin
    .from('alert_recipients')
    .select(RECIPIENT_COLUMNS)
    .eq('id', id)
    .maybeSingle<RecipientRow>();

  if (fetchErr) {
    console.error('[api/admin/recipients PATCH] fetch failed:', fetchErr);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Merged post-patch view — used to enforce "at least one severity channel".
  const merged: RecipientRow = {
    ...before,
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.full_name !== undefined ? { full_name: patch.full_name } : {}),
    ...(patch.receives_p0 !== undefined ? { receives_p0: patch.receives_p0 } : {}),
    ...(patch.receives_p1 !== undefined ? { receives_p1: patch.receives_p1 } : {}),
    ...(patch.receives_p2 !== undefined ? { receives_p2: patch.receives_p2 } : {}),
    ...(patch.categories !== undefined ? { categories: patch.categories } : {}),
    ...(patch.quiet_hours_start !== undefined ? { quiet_hours_start: patch.quiet_hours_start } : {}),
    ...(patch.quiet_hours_end !== undefined ? { quiet_hours_end: patch.quiet_hours_end } : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
  };

  if (!merged.receives_p0 && !merged.receives_p1 && !merged.receives_p2) {
    return NextResponse.json(
      {
        error: 'no_active_channels',
        message: 'Recipient must receive at least one of P0, P1, or P2 alerts.',
        field: 'receives_p0',
      },
      { status: 400 },
    );
  }

  // Quiet-hours coherence after merge (both null OR both set).
  const qhs = merged.quiet_hours_start;
  const qhe = merged.quiet_hours_end;
  if ((qhs === null) !== (qhe === null)) {
    return NextResponse.json(
      {
        error: 'quiet_hours_mismatch',
        message: 'Quiet-hours start and end must both be set or both be null.',
        field: 'quiet_hours_start',
      },
      { status: 400 },
    );
  }

  const updateSet: Record<string, unknown> = {};
  if (patch.email !== undefined) updateSet.email = patch.email;
  if (patch.full_name !== undefined) updateSet.full_name = patch.full_name;
  if (patch.receives_p0 !== undefined) updateSet.receives_p0 = patch.receives_p0;
  if (patch.receives_p1 !== undefined) updateSet.receives_p1 = patch.receives_p1;
  if (patch.receives_p2 !== undefined) updateSet.receives_p2 = patch.receives_p2;
  if (patch.categories !== undefined) updateSet.categories = patch.categories;
  if (patch.quiet_hours_start !== undefined) updateSet.quiet_hours_start = patch.quiet_hours_start;
  if (patch.quiet_hours_end !== undefined) updateSet.quiet_hours_end = patch.quiet_hours_end;
  if (patch.timezone !== undefined) updateSet.timezone = patch.timezone;
  if (patch.active !== undefined) updateSet.active = patch.active;

  if (Object.keys(updateSet).length === 0) {
    return NextResponse.json({ ok: true, changed: [] });
  }

  const { error: updateErr } = await admin
    .from('alert_recipients')
    .update(updateSet)
    .eq('id', id);

  if (updateErr) {
    if (updateErr.code === '23505') {
      return NextResponse.json(
        { error: 'duplicate_email', message: 'A recipient with this email already exists.' },
        { status: 409 },
      );
    }
    console.error('[api/admin/recipients PATCH] update failed:', updateErr);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Build before/after dicts with only the fields that actually changed.
  const beforeDelta: Record<string, unknown> = {};
  const afterDelta: Record<string, unknown> = {};
  for (const key of Object.keys(updateSet) as (keyof RecipientRow)[]) {
    const oldVal = before[key];
    const newVal = updateSet[key as string];
    if (!deepEqual(oldVal, newVal)) {
      beforeDelta[key] = oldVal;
      afterDelta[key] = newVal;
    }
  }

  if (Object.keys(afterDelta).length > 0) {
    void logAuditFromRequest(request, {
      actorType: 'admin',
      actorUserId: gate.userId,
      action: 'admin.override',
      entityType: 'alert_recipient',
      entityId: id,
      before: beforeDelta,
      after: afterDelta,
      metadata: { route: '/api/admin/recipients/[id]', method: 'PATCH' },
      severity: 'warning',
    });
  }

  return NextResponse.json({ ok: true, changed: Object.keys(afterDelta) });
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const gate = await requireAdminRoleForApi('super_admin');
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const admin = createServiceClient();

  const { data: before, error: fetchErr } = await admin
    .from('alert_recipients')
    .select('id, active')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[api/admin/recipients DELETE] fetch failed:', fetchErr);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!before.active) {
    // Idempotent: re-deleting an already-inactive row is a no-op.
    return NextResponse.json({ ok: true, alreadyInactive: true });
  }

  const { error: updateErr } = await admin
    .from('alert_recipients')
    .update({ active: false })
    .eq('id', id);

  if (updateErr) {
    console.error('[api/admin/recipients DELETE] deactivate failed:', updateErr);
    return NextResponse.json({ error: 'deactivate_failed' }, { status: 500 });
  }

  void logAuditFromRequest(request, {
    actorType: 'admin',
    actorUserId: gate.userId,
    action: 'admin.override',
    entityType: 'alert_recipient',
    entityId: id,
    before: { active: true },
    after: { active: false },
    metadata: { route: '/api/admin/recipients/[id]', method: 'DELETE', soft: true },
    severity: 'warning',
  });

  return NextResponse.json({ ok: true });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}
