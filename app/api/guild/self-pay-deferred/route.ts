import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia' as any,
});

/**
 * POST /api/guild/self-pay-deferred
 *
 * Creates a Stripe Checkout session for the exact current deferred balance of
 * the authenticated Guildmember. The price is dynamic (price_data with
 * unit_amount = balance in cents) rather than a fixed Stripe Price — every
 * member's balance differs, and it can change between when probation starts
 * and when they decide to self-pay.
 *
 * Session metadata is the contract with the webhook handler:
 *   type:        'guild_self_pay_deferred'
 *   member_id:   guild_members.id           (used to find deferred rows)
 *   user_id:     auth user id                (used as waiver_granted_by)
 *   balance_usd: the amount at session creation (audit trail)
 *
 * The webhook does the actual row mutation — this endpoint only creates the
 * Checkout session. If a member's balance changes between session creation
 * and payment (e.g. a monthly close runs and adds to deferred, or another
 * commission partially clears it), the webhook handles current-state truth;
 * it waives whatever is deferred at payment time, not at session-creation
 * time.
 *
 * Guards:
 *   - 401 if unauthenticated
 *   - 403 if not a Guildmember
 *   - 400 if balance is $0 or negative (nothing to pay)
 *   - 500 on Stripe error
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('id, display_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: 'Not a Guild member' }, { status: 403 });
  }

  // Read authoritative balance from the RPC — matches what guild_account_fees
  // rows will be summed against in the webhook.
  const { data: balanceRaw, error: balanceErr } = await admin.rpc(
    'guild_deferred_balance_usd',
    { p_guildmember_id: member.id },
  );
  if (balanceErr) {
    console.error('[self-pay-deferred] Balance RPC error:', balanceErr);
    return NextResponse.json(
      { error: 'Unable to read deferred balance' },
      { status: 500 },
    );
  }
  const balanceUsd = Number(balanceRaw ?? 0);
  if (balanceUsd <= 0) {
    return NextResponse.json(
      { error: 'No deferred balance to clear', balance_usd: balanceUsd },
      { status: 400 },
    );
  }

  // Round to cents. Stripe requires integer unit_amount.
  const unitAmountCents = Math.round(balanceUsd * 100);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmountCents,
            product_data: {
              name: 'Penworth Guild — deferred account fee balance',
              description:
                'Clears your deferred Guild account fee balance and immediately restores agent access.',
            },
          },
        },
      ],
      metadata: {
        type: 'guild_self_pay_deferred',
        member_id: member.id,
        user_id: user.id,
        balance_usd: balanceUsd.toFixed(2),
      },
      success_url: `${appUrl}/guild/dashboard/financials?self_pay=success`,
      cancel_url: `${appUrl}/guild/dashboard/financials?self_pay=cancelled`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: 'Stripe returned no checkout URL' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      url: session.url,
      session_id: session.id,
      balance_usd: balanceUsd,
    });
  } catch (err: any) {
    console.error('[self-pay-deferred] Stripe error:', err);
    return NextResponse.json(
      { error: err?.message || 'Stripe checkout failed' },
      { status: 500 },
    );
  }
}
