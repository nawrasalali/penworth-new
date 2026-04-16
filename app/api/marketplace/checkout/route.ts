import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia' as any,
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { listingId } = body;

    if (!listingId) {
      return NextResponse.json({ error: 'Listing ID required' }, { status: 400 });
    }

    // Fetch the listing
    const { data: listing, error: listingError } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('id', listingId)
      .eq('status', 'published')
      .single();

    if (listingError || !listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    // Check if already purchased
    const { data: existingPurchase } = await supabase
      .from('marketplace_purchases')
      .select('id')
      .eq('user_id', user.id)
      .eq('listing_id', listingId)
      .single();

    if (existingPurchase) {
      return NextResponse.json({ error: 'Already purchased' }, { status: 400 });
    }

    // Free listing - just create the purchase
    if (listing.price === 0) {
      const { error: purchaseError } = await supabase
        .from('marketplace_purchases')
        .insert({
          user_id: user.id,
          listing_id: listingId,
          price_paid: 0,
          status: 'completed',
        });

      if (purchaseError) throw purchaseError;

      // Increment downloads
      await supabase
        .from('marketplace_listings')
        .update({ downloads_count: (listing.downloads_count || 0) + 1 })
        .eq('id', listingId);

      return NextResponse.json({ success: true, free: true });
    }

    // Paid listing - create Stripe checkout session
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: listing.title,
              description: listing.description || 'Penworth Book',
              images: listing.cover_url ? [listing.cover_url] : [],
            },
            unit_amount: Math.round(listing.price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: user.id,
        listingId: listing.id,
        authorId: listing.author_id,
        type: 'marketplace_purchase',
      },
      success_url: `${appUrl}/marketplace/${listing.id}?purchased=true`,
      cancel_url: `${appUrl}/marketplace/${listing.id}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Marketplace checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
