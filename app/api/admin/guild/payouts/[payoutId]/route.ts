import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAuditFromRequest, type AuditSeverity } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Status =
  | 'queued'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

/**
 * Explicit state-machine table: each key is the CURRENT status, each value
 * is the set of statuses it is allowed to transition TO from the admin UI.
 * Any transition not listed here is rejected.
 */
const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  queued: ['approved', 'cancelled'],
  approved: ['processing', 'queued'],
  processing: ['sent', 'failed'],
  sent: ['confirmed'],
  failed: ['queued'],
  confirmed: [],
  cancelled: [],
};

/**
 * POST /api/admin/guild/payouts/[payoutId]
 * Body: { to: Status, reference?: string | null, reason?: string | null }
 *
 * Drives the payout row through its allowed state transitions. Records the
 * admin user in approved_by on approve, sets sent_at / confirmed_at on
 * sent / confirmed, and stores failure_reason on failed / cancelled.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ payoutId: string }> }) {
  const params = await props.params;
  const { payoutId } = params;

  // Authz — we gate on profiles.is_admin explicitly, in addition to the
  // /admin/* layout guard, because this is a mutation endpoint.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const to = String(body?.to ?? '') as Status;
  const reference =
    typeof body?.reference === 'string' ? body.reference.trim() : null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : null;

  if (!isStatus(to)) {
    return NextResponse.json(
      { error: `invalid target status "${to}"` },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Load the row to check current status
  const { data: current, error: loadErr } = await admin
    .from('guild_payouts')
    .select('id, status, guildmember_id, payout_month, amount_usd')
    .eq('id', payoutId)
    .maybeSingle();

  if (loadErr || !current) {
    return NextResponse.json({ error: 'payout not found' }, { status: 404 });
  }

  const from = current.status as Status;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return NextResponse.json(
      {
        error: `cannot transition from "${from}" to "${to}"`,
        allowed,
      },
      { status: 409 },
    );
  }

  // Build the update payload
  const now = new Date().toISOString();
  const updates: Record<string, any> = {
    status: to,
    updated_at: now,
  };

  switch (to) {
    case 'approved':
      updates.approved_by = user.id;
      updates.approved_at = now;
      break;

    case 'queued':
      // Retrying from failed, or un-approving from approved — clear stale state
      updates.approved_by = null;
      updates.approved_at = null;
      if (from === 'failed') updates.failure_reason = null;
      break;

    case 'sent':
      updates.sent_at = now;
      if (!reference) {
        return NextResponse.json(
          { error: 'reference_number is required when marking sent' },
          { status: 400 },
        );
      }
      updates.reference_number = reference;
      break;

    case 'confirmed':
      updates.confirmed_at = now;
      break;

    case 'failed':
      if (!reason) {
        return NextResponse.json(
          { error: 'failure_reason is required when marking failed' },
          { status: 400 },
        );
      }
      updates.failure_reason = reason;
      break;

    case 'cancelled':
      if (!reason) {
        return NextResponse.json(
          { error: 'cancellation reason is required' },
          { status: 400 },
        );
      }
      updates.failure_reason = reason; // reuse column for the free-text note
      break;
  }

  const { error: updErr } = await admin
    .from('guild_payouts')
    .update(updates)
    .eq('id', payoutId)
    .eq('status', from); // optimistic concurrency: only if still in `from`

  if (updErr) {
    console.error('[admin.guild.payouts] update failed:', updErr);
    return NextResponse.json(
      { error: 'failed to update payout' },
      { status: 500 },
    );
  }

  // Audit trail — admin.override. Payouts are real money leaving the
  // business, so every single state change goes in the append-only log.
  // Critical-severity transitions:
  //   'sent'      → money just went out the door (Wise / USDT payment).
  //   'failed'    → payment attempt failed; triage required.
  //   'cancelled' → admin reversed a queued/approved payout; the reason
  //                 is mandatory and captured above.
  // Other transitions are info-level but still logged for the complete
  // audit chain (approved, processing, confirmed, re-queue).
  const severity: AuditSeverity =
    to === 'sent' || to === 'failed' || to === 'cancelled' ? 'critical' : 'info';

  void logAuditFromRequest(req, {
    actorType: 'admin',
    actorUserId: user.id,
    action: 'admin.override',
    entityType: 'guild_payout',
    entityId: payoutId,
    before: { status: from },
    after: {
      status: to,
      reference_number: reference ?? null,
      failure_reason: reason ?? null,
    },
    metadata: {
      guildmember_id: current.guildmember_id,
      payout_month: current.payout_month,
      amount_usd: current.amount_usd,
      transition: `${from}→${to}`,
    },
    severity,
  });

  return NextResponse.json({
    ok: true,
    payout_id: payoutId,
    from,
    to,
    reference: reference ?? null,
    reason: reason ?? null,
  });
}

function isStatus(s: string): s is Status {
  return [
    'queued',
    'approved',
    'processing',
    'sent',
    'confirmed',
    'failed',
    'cancelled',
  ].includes(s);
}
