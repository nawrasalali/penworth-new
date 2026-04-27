/**
 * Shared Stripe.Event JSON fixtures for the Phase 1 process-event +
 * reconcile-replay unit tests (CEO-186).
 *
 * These are intentionally minimal: only the fields the dispatcher/handlers
 * read are populated. The Stripe SDK's TypeScript types are very wide, so
 * each builder casts through `unknown` to keep call sites readable.
 *
 * Naming: makeXEvent() returns a full Stripe.Event; makeXObject() returns
 * just the inner data object (used when a handler is called directly with
 * the object rather than via processStripeEvent).
 */

import type Stripe from 'stripe';

// Env vars for plan-from-priceId resolution. We set these in beforeAll
// of the test files; consumers reference these constants so the fixture
// IDs always match what process-event reads from process.env.
export const PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
export const PRICE_PRO_ANNUAL = 'price_pro_annual_test';
export const PRICE_MAX_MONTHLY = 'price_max_monthly_test';
export const PRICE_MAX_ANNUAL = 'price_max_annual_test';

export const TEST_USER_ID = 'user-test-uuid-0001';
export const TEST_CUSTOMER_ID = 'cus_test_0001';
export const TEST_SUBSCRIPTION_ID = 'sub_test_0001';
export const TEST_INVOICE_ID = 'in_test_0001';
export const TEST_CHARGE_ID = 'ch_test_0001';
export const TEST_DISPUTE_ID = 'dp_test_0001';
export const TEST_SESSION_ID = 'cs_test_0001';
export const TEST_ORG_ID = 'org-test-0001';

// ─────────────────────────────────────────────────────────────────────
// checkout.session.completed
// ─────────────────────────────────────────────────────────────────────

export interface CheckoutCompletedOpts {
  metadata?: Record<string, string>;
  subscription?: string | null;
  mode?: 'subscription' | 'payment';
  customer?: string;
  sessionId?: string;
}

export function makeCheckoutCompletedEvent(opts: CheckoutCompletedOpts = {}): Stripe.Event {
  const session: Partial<Stripe.Checkout.Session> = {
    id: opts.sessionId ?? TEST_SESSION_ID,
    object: 'checkout.session',
    customer: opts.customer ?? TEST_CUSTOMER_ID,
    mode: opts.mode ?? 'subscription',
    subscription: opts.subscription ?? TEST_SUBSCRIPTION_ID,
    metadata: opts.metadata ?? { userId: TEST_USER_ID },
  };
  return {
    id: 'evt_checkout_completed',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session as Stripe.Checkout.Session },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────
// customer.subscription.updated / deleted
// ─────────────────────────────────────────────────────────────────────

export interface SubscriptionEventOpts {
  priceId?: string;
  customerId?: string;
  subscriptionId?: string;
  cancellationReason?: string | null;
}

export function makeSubscription(opts: SubscriptionEventOpts = {}): Stripe.Subscription {
  return {
    id: opts.subscriptionId ?? TEST_SUBSCRIPTION_ID,
    object: 'subscription',
    customer: opts.customerId ?? TEST_CUSTOMER_ID,
    status: 'active',
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_0001',
          price: {
            id: opts.priceId ?? PRICE_PRO_MONTHLY,
            unit_amount: 999,
          } as Stripe.Price,
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: '',
    },
    cancellation_details: opts.cancellationReason
      ? { reason: opts.cancellationReason }
      : null,
    latest_invoice: TEST_INVOICE_ID,
  } as unknown as Stripe.Subscription;
}

export function makeSubscriptionUpdatedEvent(opts: SubscriptionEventOpts = {}): Stripe.Event {
  return {
    id: 'evt_subscription_updated',
    object: 'event',
    type: 'customer.subscription.updated',
    data: { object: makeSubscription(opts) },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

export function makeSubscriptionDeletedEvent(opts: SubscriptionEventOpts = {}): Stripe.Event {
  return {
    id: 'evt_subscription_deleted',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: { object: makeSubscription(opts) },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────
// invoice.payment_succeeded / payment_failed
// ─────────────────────────────────────────────────────────────────────

export interface InvoiceEventOpts {
  billingReason?: Stripe.Invoice.BillingReason;
  customerId?: string;
  invoiceId?: string;
  amountPaid?: number;
  paymentIntentId?: string;
}

export function makeInvoice(opts: InvoiceEventOpts = {}): Stripe.Invoice {
  return {
    id: opts.invoiceId ?? TEST_INVOICE_ID,
    object: 'invoice',
    customer: opts.customerId ?? TEST_CUSTOMER_ID,
    billing_reason: opts.billingReason ?? 'subscription_cycle',
    amount_paid: opts.amountPaid ?? 999,
    payment_intent: opts.paymentIntentId ?? 'pi_test_0001',
  } as unknown as Stripe.Invoice;
}

export function makePaymentSucceededEvent(opts: InvoiceEventOpts = {}): Stripe.Event {
  return {
    id: 'evt_invoice_payment_succeeded',
    object: 'event',
    type: 'invoice.payment_succeeded',
    data: { object: makeInvoice(opts) },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

export function makePaymentFailedEvent(opts: InvoiceEventOpts = {}): Stripe.Event {
  return {
    id: 'evt_invoice_payment_failed',
    object: 'event',
    type: 'invoice.payment_failed',
    data: { object: makeInvoice(opts) },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────
// charge.refunded / charge.dispute.created
// ─────────────────────────────────────────────────────────────────────

export function makeChargeRefundedEvent(
  opts: { invoiceId?: string | null; amount?: number; refunded?: number; chargeId?: string } = {},
): Stripe.Event {
  return {
    id: 'evt_charge_refunded',
    object: 'event',
    type: 'charge.refunded',
    data: {
      object: {
        id: opts.chargeId ?? TEST_CHARGE_ID,
        object: 'charge',
        invoice: opts.invoiceId === undefined ? TEST_INVOICE_ID : opts.invoiceId,
        amount: opts.amount ?? 999,
        amount_refunded: opts.refunded ?? 999,
        currency: 'usd',
      } as unknown as Stripe.Charge,
    },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

export function makeChargeDisputeEvent(
  opts: { chargeId?: string; amount?: number } = {},
): Stripe.Event {
  return {
    id: 'evt_charge_dispute_created',
    object: 'event',
    type: 'charge.dispute.created',
    data: {
      object: {
        id: TEST_DISPUTE_ID,
        object: 'dispute',
        charge: opts.chargeId ?? TEST_CHARGE_ID,
        amount: opts.amount ?? 999,
        currency: 'usd',
        status: 'warning_needs_response',
        reason: 'fraudulent',
        is_charge_refundable: true,
      } as unknown as Stripe.Dispute,
    },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}

// ─────────────────────────────────────────────────────────────────────
// Unhandled
// ─────────────────────────────────────────────────────────────────────

export function makeUnhandledEvent(): Stripe.Event {
  return {
    id: 'evt_unhandled_type',
    object: 'event',
    type: 'payment_method.attached',
    data: { object: { id: 'pm_test', object: 'payment_method' } },
    api_version: '2024-12-18.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  } as unknown as Stripe.Event;
}
