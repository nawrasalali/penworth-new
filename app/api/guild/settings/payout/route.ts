import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  encryptPayoutDetails,
  maskPayoutDestination,
} from '@/lib/guild/payout-encryption';

export const dynamic = 'force-dynamic';

/**
 * POST /api/guild/settings/payout
 * Body: { method: 'wise' | 'usdt', value: string, tax_residency?: string }
 *
 * Encrypts the payout destination server-side (never round-trips plaintext
 * back to the client) and writes to guild_members. Returns the masked form
 * so the UI can confirm what was saved.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const method = String(body?.method ?? '').toLowerCase();
  const rawValue = typeof body?.value === 'string' ? body.value.trim() : '';
  const taxResidency =
    typeof body?.tax_residency === 'string' ? body.tax_residency.trim() : null;

  if (method !== 'wise' && method !== 'usdt') {
    return NextResponse.json(
      { error: 'method must be "wise" or "usdt"' },
      { status: 400 },
    );
  }

  // Per-method validation
  if (method === 'wise') {
    // Minimal email check — a more permissive RFC regex than strict but catches
    // the common typos (no @, no dot after @, trailing space already trimmed).
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue);
    if (!emailOk) {
      return NextResponse.json(
        { error: 'Wise account must be a valid email address' },
        { status: 400 },
      );
    }
  } else {
    // USDT wallet — TRC20 (starts with T, 34 chars) or ERC20/BEP20 (starts 0x, 42 chars)
    const tron = /^T[a-zA-Z0-9]{33}$/.test(rawValue);
    const evm = /^0x[a-fA-F0-9]{40}$/.test(rawValue);
    if (!tron && !evm) {
      return NextResponse.json(
        {
          error:
            'USDT wallet must be a TRC20 address (T…, 34 chars) or ERC20/BEP20 address (0x…, 42 chars)',
        },
        { status: 400 },
      );
    }
  }

  // Confirm the caller is actually a Guild member
  const admin = createAdminClient();
  const { data: member, error: memberErr } = await admin
    .from('guild_members')
    .select('id, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberErr || !member) {
    return NextResponse.json(
      { error: 'not a Guild member' },
      { status: 403 },
    );
  }

  if (member.status === 'terminated' || member.status === 'resigned') {
    return NextResponse.json(
      { error: `cannot update payout — membership ${member.status}` },
      { status: 403 },
    );
  }

  // Encrypt using guildmember_id (stable even if user_id changes)
  let encrypted: string;
  try {
    encrypted = encryptPayoutDetails(member.id, { value: rawValue });
  } catch (err: any) {
    console.error('[guild.settings] encryption failed:', err?.message);
    return NextResponse.json(
      { error: 'encryption key not configured on server' },
      { status: 500 },
    );
  }

  const masked = maskPayoutDestination(method as 'wise' | 'usdt', rawValue);

  const updates: Record<string, any> = {
    payout_method: method,
    payout_details_encrypted: encrypted,
    updated_at: new Date().toISOString(),
  };
  if (taxResidency) {
    updates.tax_residency = taxResidency.slice(0, 2).toUpperCase(); // ISO-2 country
  }

  const { error: updErr } = await admin
    .from('guild_members')
    .update(updates)
    .eq('id', member.id);

  if (updErr) {
    console.error('[guild.settings] DB write failed:', updErr);
    return NextResponse.json(
      { error: 'failed to save payout settings' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    method,
    masked,
    tax_residency: updates.tax_residency ?? null,
  });
}

/**
 * GET /api/guild/settings/payout
 * Returns the current member's payout method + mask (NEVER plaintext).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, payout_method, payout_details_encrypted, tax_residency')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: 'not a Guild member' }, { status: 403 });
  }

  const { maskPayoutDestinationSafe } = await import('@/lib/guild/payout-encryption');
  const masked = member.payout_method
    ? maskPayoutDestinationSafe(
        member.payout_method,
        member.id,
        member.payout_details_encrypted,
      )
    : null;

  return NextResponse.json({
    method: member.payout_method ?? null,
    masked,
    tax_residency: member.tax_residency ?? null,
  });
}
