import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';
import {
  recordStripeEvent,
  markStripeEventProcessed,
  markStripeEventFailed,
  markStripeEventSkipped,
} from '@/lib/stripe/webhook-idempotency';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Credit pack price IDs
const CREDIT_PACK_PRICES = {
  'price_1TM90DDAwDFDea8LXyYMDoYU': 1000,  // 1000 credits
  'price_1TM91IDAwDFDea8LFYWHxO1C': 3000,  // 3000 credits
  'price_1TM91zDAwDFDea8LlLpGQetJ': 10000, // 10000 credits
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Idempotency gate — see lib/stripe/webhook-idempotency.ts.
    // Note: the /api/stripe/webhook route also runs this gate. Because both
    // webhooks share a single stripe_webhook_events table keyed by
    // stripe_event_id, whichever one processes an event first will record
    // it; the other will see it as a duplicate and return early. This is
    // fine — the two routes historically handled different subsets (main
    // = subscriptions + Guild commissions, this = credit packs), but the
    // shared gate prevents any accidental double-processing if Stripe
    // ever routes the same event to both endpoints.
    const gate = await recordStripeEvent(supabase, event, 'webhook');
    if (!gate.shouldProcess) {
      console.log(
        `[webhooks/stripe] Skipping event ${event.id} (${event.type}): ${gate.reason}`,
      );
      return NextResponse.json({ received: true, duplicate: true });
    }

    let handled = true;
    try {
      switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Handle credit pack purchase (one-time payment)
        if (session.mode === 'payment') {
          const userId = session.metadata?.user_id;
          const priceId = session.metadata?.price_id;
          
          if (userId && priceId && priceId in CREDIT_PACK_PRICES) {
            const creditsToAdd = CREDIT_PACK_PRICES[priceId as keyof typeof CREDIT_PACK_PRICES];
            
            // Get current profile
            const { data: profile } = await supabase
              .from('profiles')
              .select('credits_balance, credits_purchased, has_purchased_credits')
              .eq('id', userId)
              .single();
            
            if (profile) {
              // Add credits and set has_purchased_credits flag (removes watermark for free users)
              await supabase
                .from('profiles')
                .update({
                  credits_balance: (profile.credits_balance || 0) + creditsToAdd,
                  credits_purchased: (profile.credits_purchased || 0) + creditsToAdd,
                  has_purchased_credits: true, // This removes the watermark for free users
                })
                .eq('id', userId);
              
              console.log(`Added ${creditsToAdd} credits to user ${userId}`);
            }
          }
        }
        
        // Handle subscription
        if (session.mode === 'subscription') {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          
          const customerId = session.customer as string;
          const userId = session.metadata?.user_id;
          const orgId = session.metadata?.org_id;

          // Determine tier based on price
          const priceId = subscription.items.data[0]?.price.id;
          let tier = 'pro';
          if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) {
            tier = 'team';
          }

          if (orgId) {
            // Update organization subscription
            await supabase
              .from('organizations')
              .update({
                stripe_customer_id: customerId,
                stripe_subscription_id: subscription.id,
                subscription_tier: tier,
              })
              .eq('id', orgId);
          } else if (userId) {
            // For individual subscriptions, update user profile.
            // Note: profiles does NOT have stripe_customer_id /
            // stripe_subscription_id / subscription_tier columns —
            // those live on organizations only. For individual users,
            // the plan name is stored in profiles.plan, and Stripe
            // identity is tracked via the 'organizations' row that
            // gets created for every user.
            await supabase
              .from('profiles')
              .update({
                plan: tier,
              })
              .eq('id', userId);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find organization by customer ID
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (org) {
          // Update subscription status
          const status = subscription.status;
          let tier = 'free';
          
          if (status === 'active' || status === 'trialing') {
            const priceId = subscription.items.data[0]?.price.id;
            tier = priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY ? 'team' : 'pro';
          }

          await supabase
            .from('organizations')
            .update({
              subscription_tier: tier,
              stripe_subscription_id: subscription.id,
            })
            .eq('id', org.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find and downgrade organization
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (org) {
          await supabase
            .from('organizations')
            .update({
              subscription_tier: 'free',
              stripe_subscription_id: null,
            })
            .eq('id', org.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Log payment failure, could send notification
        console.error(`Payment failed for customer ${customerId}`);
        break;
      }

      default:
        handled = false;
        // Unhandled event type
        console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (innerErr) {
      await markStripeEventFailed(supabase, event.id, innerErr);
      throw innerErr; // rethrow to outer catch for 500 response
    }

    if (handled) {
      await markStripeEventProcessed(supabase, event.id);
    } else {
      await markStripeEventSkipped(supabase, event.id, `unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
