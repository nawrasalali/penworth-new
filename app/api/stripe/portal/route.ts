import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripeOrError } from '@/lib/stripe/client';

export async function POST() {
  try {
    const stripeResult = getStripeOrError();
    if (stripeResult.error) return stripeResult.error;
    const stripe = stripeResult.stripe;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization with Stripe customer ID
    const { data: orgMember } = await supabase
      .from('org_members')
      .select('organizations(stripe_customer_id)')
      .eq('user_id', user.id)
      .single();

    const customerId = (orgMember?.organizations as any)?.stripe_customer_id;

    if (!customerId) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Portal error:', error);
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    );
  }
}
