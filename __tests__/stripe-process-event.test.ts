/**
 * Unit tests for processStripeEvent (lib/stripe/process-event.ts).
 *
 * Strategy:
 *   - vi.mock @supabase/supabase-js with a factory that exposes a tracking
 *     query-builder. Every .from(table).update/insert/select call appends
 *     to a `dbCalls` array we assert against.
 *   - vi.mock lib/guild/commissions and lib/audit so we can assert the
 *     guild + audit hooks fired (or didn't) without running their real
 *     implementations.
 *   - vi.mock lib/stripe/client to return a stub Stripe SDK with the
 *     methods the dispatcher and handlers actually call
 *     (subscriptions.retrieve, charges.retrieve).
 *   - The price-id env vars are populated in beforeAll so the plan-from-
 *     price resolver maps PRICE_PRO_MONTHLY → 'pro' etc.
 *
 * Each test resets the mock state, dispatches one event via
 * processStripeEvent(), and asserts on (a) the returned outcome and
 * (b) the recorded DB / guild / audit calls.
 *
 * CEO-186 Phase 1.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  PRICE_PRO_MONTHLY,
  PRICE_PRO_ANNUAL,
  PRICE_MAX_MONTHLY,
  PRICE_MAX_ANNUAL,
  TEST_USER_ID,
  TEST_CUSTOMER_ID,
  TEST_SUBSCRIPTION_ID,
  TEST_INVOICE_ID,
  TEST_CHARGE_ID,
  TEST_DISPUTE_ID,
  TEST_SESSION_ID,
  TEST_ORG_ID,
  makeCheckoutCompletedEvent,
  makeSubscriptionUpdatedEvent,
  makeSubscriptionDeletedEvent,
  makePaymentSucceededEvent,
  makePaymentFailedEvent,
  makeChargeRefundedEvent,
  makeChargeDisputeEvent,
  makeUnhandledEvent,
} from './_helpers/stripe-fixtures';

// ─────────────────────────────────────────────────────────────────────
// Mock state — populated by the @supabase/supabase-js factory below.
// Reset in beforeEach.
// ─────────────────────────────────────────────────────────────────────

interface DbCall {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  filters: Record<string, unknown>;
  values?: Record<string, unknown>;
}

interface MockState {
  // Calls captured for assertion
  calls: DbCall[];
  // Per-table fixed responses for select().single() and select(...).eq().single()
  selectResponses: Record<string, unknown>;
  // Stripe SDK stubs
  subscriptionRetrieveResponse: unknown;
  chargeRetrieveResponse: unknown;
  // Guild hook tracking
  guildCalls: { name: string; args: unknown }[];
  auditCalls: { args: unknown }[];
}

const state: MockState = {
  calls: [],
  selectResponses: {},
  subscriptionRetrieveResponse: null,
  chargeRetrieveResponse: null,
  guildCalls: [],
  auditCalls: [],
};

// ─────────────────────────────────────────────────────────────────────
// Mocks — must run BEFORE the SUT is imported, hence vi.mock at top level.
// ─────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' | null = null;
    let values: Record<string, unknown> | undefined;

    const record = (extra?: Partial<DbCall>) => {
      state.calls.push({ table, op: op ?? 'select', filters: { ...filters }, values, ...extra });
    };

    const builder: Record<string, unknown> = {
      select(_cols?: string) {
        if (!op) op = 'select';
        return builder;
      },
      update(v: Record<string, unknown>) {
        op = 'update';
        values = v;
        return builder;
      },
      insert(v: Record<string, unknown>) {
        op = 'insert';
        values = v;
        record();
        // Insert returns chainable for .select().single() but tests don't read it
        return builder;
      },
      upsert(v: Record<string, unknown>) {
        op = 'upsert';
        values = v;
        record();
        return builder;
      },
      delete() {
        op = 'delete';
        return builder;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      not(col: string, _opName: string, val: unknown) {
        filters[`not_${col}`] = val;
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters[`${col}_in`] = vals;
        return builder;
      },
      gte(col: string, val: unknown) {
        filters[`${col}_gte`] = val;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async single() {
        // For select-then-single calls. Look up by table + filter.
        if (op === 'update') {
          record();
          return { data: null, error: null };
        }
        const key = `${table}:${JSON.stringify(filters)}`;
        const data = state.selectResponses[key] ?? state.selectResponses[table] ?? null;
        return { data, error: null };
      },
      // Promise-like for non-single terminal calls (insert/update/upsert
      // without a chained .single()).
      then(resolve: (v: unknown) => unknown) {
        if (op === 'update') {
          record();
        } else if (op === 'select') {
          // .from('t').select(...).eq(...).not(...) — return list
          const data = state.selectResponses[`${table}:list`] ?? [];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  }

  const mockClient = {
    from: (table: string) => makeBuilder(table),
  };

  return {
    createClient: vi.fn(() => mockClient),
  };
});

vi.mock('@/lib/guild/commissions', () => ({
  recordFirstPayment: vi.fn(async (args: unknown) => {
    state.guildCalls.push({ name: 'recordFirstPayment', args });
  }),
  recordRenewalPayment: vi.fn(async (args: unknown) => {
    state.guildCalls.push({ name: 'recordRenewalPayment', args });
  }),
  handleSubscriptionCancelled: vi.fn(async (args: unknown) => {
    state.guildCalls.push({ name: 'handleSubscriptionCancelled', args });
  }),
  handleRefund: vi.fn(async (args: unknown) => {
    state.guildCalls.push({ name: 'handleRefund', args });
    return { ok: true };
  }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (args: unknown) => {
    state.auditCalls.push({ args });
  }),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripeOrError: vi.fn(() => ({
    stripe: {
      subscriptions: {
        retrieve: vi.fn(async () => state.subscriptionRetrieveResponse),
      },
      charges: {
        retrieve: vi.fn(async () => state.chargeRetrieveResponse),
      },
    },
    error: null,
  })),
}));

// ─────────────────────────────────────────────────────────────────────
// SUT import — AFTER vi.mock declarations
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line import/first
import { processStripeEvent } from '@/lib/stripe/process-event';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function findCall(table: string, op: DbCall['op']): DbCall | undefined {
  return state.calls.find((c) => c.table === table && c.op === op);
}

function findCalls(table: string, op: DbCall['op']): DbCall[] {
  return state.calls.filter((c) => c.table === table && c.op === op);
}

function setOrgLookup(userId: string, customerId: string, orgId: string) {
  // organizations select by stripe_customer_id → { id }
  state.selectResponses[
    `organizations:${JSON.stringify({ stripe_customer_id: customerId })}`
  ] = { id: orgId };
  // org_members select by org_id+role=owner → { user_id }
  state.selectResponses[
    `org_members:${JSON.stringify({ org_id: orgId, role: 'owner' })}`
  ] = { user_id: userId };
}

// ─────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.STRIPE_PRICE_PRO_MONTHLY = PRICE_PRO_MONTHLY;
  process.env.STRIPE_PRICE_PRO_ANNUAL = PRICE_PRO_ANNUAL;
  process.env.STRIPE_PRICE_MAX_MONTHLY = PRICE_MAX_MONTHLY;
  process.env.STRIPE_PRICE_MAX_ANNUAL = PRICE_MAX_ANNUAL;
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv_role_test';
});

beforeEach(() => {
  state.calls = [];
  state.selectResponses = {};
  state.subscriptionRetrieveResponse = null;
  state.chargeRetrieveResponse = null;
  state.guildCalls = [];
  state.auditCalls = [];
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('processStripeEvent — checkout.session.completed', () => {
  it('subscription activation: Pro monthly grants 2000 credits and updates org', async () => {
    state.subscriptionRetrieveResponse = {
      items: { data: [{ price: { id: PRICE_PRO_MONTHLY, unit_amount: 999 } }] },
      latest_invoice: TEST_INVOICE_ID,
    };
    state.selectResponses[
      `org_members:${JSON.stringify({ user_id: TEST_USER_ID, role: 'owner' })}`
    ] = { org_id: TEST_ORG_ID };

    const event = makeCheckoutCompletedEvent({ metadata: { userId: TEST_USER_ID } });
    const outcome = await processStripeEvent(event);

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.plan).toBe('pro');
    expect(profileUpdate?.values?.credits_balance).toBe(2_000);
    const orgUpdate = findCall('organizations', 'update');
    expect(orgUpdate?.values?.subscription_tier).toBe('pro');
    expect(orgUpdate?.values?.stripe_subscription_id).toBe(TEST_SUBSCRIPTION_ID);
    const creditTx = findCall('credit_transactions', 'insert');
    expect(creditTx?.values?.amount).toBe(2_000);
    expect(creditTx?.values?.transaction_type).toBe('purchase');
    // Guild first-payment fired
    expect(state.guildCalls.find((c) => c.name === 'recordFirstPayment')).toBeTruthy();
  });

  it('subscription activation: Max annual grants 5000 credits', async () => {
    state.subscriptionRetrieveResponse = {
      items: { data: [{ price: { id: PRICE_MAX_ANNUAL, unit_amount: 19_999 } }] },
      latest_invoice: TEST_INVOICE_ID,
    };
    state.selectResponses[
      `org_members:${JSON.stringify({ user_id: TEST_USER_ID, role: 'owner' })}`
    ] = { org_id: TEST_ORG_ID };

    const outcome = await processStripeEvent(
      makeCheckoutCompletedEvent({ metadata: { userId: TEST_USER_ID } }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.plan).toBe('max');
    expect(profileUpdate?.values?.credits_balance).toBe(5_000);
  });

  it('credit pack purchase: Triple pack adds 3000 credits to credits_purchased', async () => {
    state.selectResponses[
      `profiles:${JSON.stringify({ id: TEST_USER_ID })}`
    ] = { credits_purchased: 1_500 };

    const outcome = await processStripeEvent(
      makeCheckoutCompletedEvent({
        mode: 'payment',
        subscription: null,
        metadata: { userId: TEST_USER_ID, creditPackId: 'v2_credits_3000' },
      }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.credits_purchased).toBe(4_500); // 1500 + 3000
    const creditTx = findCall('credit_transactions', 'insert');
    expect(creditTx?.values?.amount).toBe(3_000);
    // Audit fired with credit_pack.purchase action
    expect(
      state.auditCalls.some(
        (c) => (c.args as { action?: string }).action === 'credit_pack.purchase',
      ),
    ).toBe(true);
  });

  it('guild_self_pay_deferred: waives non-terminal deferred fee rows', async () => {
    // The .from('guild_account_fees').select(...).eq(...).not(...) terminal
    // chain in handleSelfPayDeferred resolves through .then() — return a
    // single deferred row to be waived.
    state.selectResponses['guild_account_fees:list'] = [
      {
        id: 'fee_1',
        amount_deferred_usd: 10,
        amount_waived_usd: 0,
        notes: null,
      },
    ];

    const outcome = await processStripeEvent(
      makeCheckoutCompletedEvent({
        mode: 'payment',
        subscription: null,
        metadata: {
          type: 'guild_self_pay_deferred',
          member_id: 'member_1',
          user_id: TEST_USER_ID,
        },
      }),
    );

    expect(outcome).toBe('handled');
    const feeUpdate = findCall('guild_account_fees', 'update');
    expect(feeUpdate?.values?.status).toBe('waived');
    expect(feeUpdate?.values?.amount_waived_usd).toBe(10);
    expect(feeUpdate?.values?.amount_deferred_usd).toBe(0);
    expect(feeUpdate?.values?.waiver_reason).toBe('self_paid_via_stripe');
  });

  it('guild_self_pay_deferred without metadata returns skipped', async () => {
    const outcome = await processStripeEvent(
      makeCheckoutCompletedEvent({
        mode: 'payment',
        subscription: null,
        metadata: { type: 'guild_self_pay_deferred' }, // no member_id/user_id
      }),
    );
    expect(outcome).toBe('skipped');
    expect(findCall('guild_account_fees', 'update')).toBeUndefined();
  });
});

describe('processStripeEvent — customer.subscription.updated', () => {
  it('upgrade: free → pro grants new monthly credits', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);
    state.selectResponses[
      `profiles:${JSON.stringify({ id: TEST_USER_ID })}`
    ] = { plan: 'free', credits_balance: 50 };

    const outcome = await processStripeEvent(
      makeSubscriptionUpdatedEvent({ priceId: PRICE_PRO_MONTHLY }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.plan).toBe('pro');
    expect(profileUpdate?.values?.credits_balance).toBe(2_000);
    expect(profileUpdate?.values?.documents_this_month).toBe(0);
    // Audit recorded change_type=upgrade
    const audit = state.auditCalls.find(
      (c) => (c.args as { action?: string }).action === 'subscription.activate',
    );
    expect((audit?.args as { metadata?: { change_type?: string } }).metadata?.change_type).toBe(
      'upgrade',
    );
  });

  it('downgrade: max → pro updates plan but does NOT grant credits', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);
    state.selectResponses[
      `profiles:${JSON.stringify({ id: TEST_USER_ID })}`
    ] = { plan: 'max', credits_balance: 4_500 };

    const outcome = await processStripeEvent(
      makeSubscriptionUpdatedEvent({ priceId: PRICE_PRO_MONTHLY }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.plan).toBe('pro');
    // No credits_balance key on update means existing value preserved
    expect(profileUpdate?.values?.credits_balance).toBeUndefined();
    expect(profileUpdate?.values?.documents_this_month).toBeUndefined();
    const audit = state.auditCalls.find(
      (c) => (c.args as { action?: string }).action === 'subscription.activate',
    );
    expect((audit?.args as { metadata?: { change_type?: string } }).metadata?.change_type).toBe(
      'downgrade',
    );
  });
});

describe('processStripeEvent — customer.subscription.deleted', () => {
  it('reverts profile to free plan, fires guild cancellation hook', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);

    const outcome = await processStripeEvent(makeSubscriptionDeletedEvent());

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.plan).toBe('free');
    // free.monthlyCredits = 1000; min(1000, 1000) = 1000
    expect(profileUpdate?.values?.credits_balance).toBe(1_000);
    const orgUpdate = findCall('organizations', 'update');
    expect(orgUpdate?.values?.subscription_tier).toBe('free');
    expect(orgUpdate?.values?.stripe_subscription_id).toBe(null);
    // Audit + guild hook
    expect(
      state.auditCalls.some(
        (c) => (c.args as { action?: string }).action === 'subscription.cancel',
      ),
    ).toBe(true);
    expect(
      state.guildCalls.some((c) => c.name === 'handleSubscriptionCancelled'),
    ).toBe(true);
  });
});

describe('processStripeEvent — invoice.payment_succeeded', () => {
  it('subscription_cycle: Pro plan resets credits to monthly amount', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);
    state.selectResponses[
      `profiles:${JSON.stringify({ id: TEST_USER_ID })}`
    ] = { plan: 'pro', credits_balance: 250 };

    const outcome = await processStripeEvent(
      makePaymentSucceededEvent({ billingReason: 'subscription_cycle' }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.credits_balance).toBe(2_000);
    expect(profileUpdate?.values?.documents_this_month).toBe(0);
    // Renewal payment recorded for guild commissions
    expect(state.guildCalls.some((c) => c.name === 'recordRenewalPayment')).toBe(true);
  });

  it('subscription_cycle: Max plan applies credit rollover (capped at 2500)', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);
    // Existing balance 3000 — rollover capped at 2500. New balance = 5000+2500 = 7500
    state.selectResponses[
      `profiles:${JSON.stringify({ id: TEST_USER_ID })}`
    ] = { plan: 'max', credits_balance: 3_000 };

    const outcome = await processStripeEvent(
      makePaymentSucceededEvent({ billingReason: 'subscription_cycle' }),
    );

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.credits_balance).toBe(7_500);
    // Audit metadata includes rollover detail
    const audit = state.auditCalls.find(
      (c) => (c.args as { action?: string }).action === 'credit.grant',
    );
    expect(
      (audit?.args as { metadata?: { rollover_applied?: number } }).metadata?.rollover_applied,
    ).toBe(2_500);
  });

  it('subscription_create early-returns: no credit reset, no audit', async () => {
    const outcome = await processStripeEvent(
      makePaymentSucceededEvent({ billingReason: 'subscription_create' }),
    );

    expect(outcome).toBe('handled');
    expect(findCall('profiles', 'update')).toBeUndefined();
    expect(state.auditCalls.length).toBe(0);
    expect(state.guildCalls.length).toBe(0);
  });
});

describe('processStripeEvent — invoice.payment_failed', () => {
  it('marks profile past_due with 7-day grace window', async () => {
    setOrgLookup(TEST_USER_ID, TEST_CUSTOMER_ID, TEST_ORG_ID);

    const outcome = await processStripeEvent(makePaymentFailedEvent());

    expect(outcome).toBe('handled');
    const profileUpdate = findCall('profiles', 'update');
    expect(profileUpdate?.values?.payment_status).toBe('past_due');
    const grace = profileUpdate?.values?.payment_grace_ends as string;
    expect(grace).toBeTruthy();
    const graceMs = new Date(grace).getTime() - Date.now();
    // ~7 days, allow 1 min slack for test runtime
    expect(graceMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
    expect(graceMs).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 60_000);
  });
});

describe('processStripeEvent — charge.refunded', () => {
  it('calls guild refund handler with clawbackAll=false and audits', async () => {
    const outcome = await processStripeEvent(makeChargeRefundedEvent());

    expect(outcome).toBe('handled');
    const guildCall = state.guildCalls.find((c) => c.name === 'handleRefund');
    expect(guildCall).toBeTruthy();
    expect(
      (guildCall?.args as { stripeInvoiceId?: string; clawbackAll?: boolean }).clawbackAll,
    ).toBe(false);
    expect(
      (guildCall?.args as { stripeInvoiceId?: string }).stripeInvoiceId,
    ).toBe(TEST_INVOICE_ID);
    // Audit fired
    expect(
      state.auditCalls.some((c) => (c.args as { action?: string }).action === 'refund.issue'),
    ).toBe(true);
  });

  it('refund without invoice: skips guild call, no audit', async () => {
    const outcome = await processStripeEvent(makeChargeRefundedEvent({ invoiceId: null }));
    expect(outcome).toBe('handled');
    expect(state.guildCalls.length).toBe(0);
    expect(state.auditCalls.length).toBe(0);
  });
});

describe('processStripeEvent — charge.dispute.created', () => {
  it('retrieves charge, calls guild refund with clawbackAll=true', async () => {
    state.chargeRetrieveResponse = {
      id: TEST_CHARGE_ID,
      invoice: TEST_INVOICE_ID,
    };

    const outcome = await processStripeEvent(makeChargeDisputeEvent());

    expect(outcome).toBe('handled');
    const guildCall = state.guildCalls.find((c) => c.name === 'handleRefund');
    expect(guildCall).toBeTruthy();
    expect(
      (guildCall?.args as { clawbackAll?: boolean }).clawbackAll,
    ).toBe(true);
    // Audit dispute with severity warning
    const audit = state.auditCalls.find(
      (c) => (c.args as { entityType?: string }).entityType === 'dispute',
    );
    expect((audit?.args as { severity?: string }).severity).toBe('warning');
  });
});

describe('processStripeEvent — unhandled', () => {
  it('returns "unhandled" with no DB writes for unknown event types', async () => {
    const outcome = await processStripeEvent(makeUnhandledEvent());

    expect(outcome).toBe('unhandled');
    expect(state.calls.filter((c) => c.op !== 'select').length).toBe(0);
    expect(state.guildCalls.length).toBe(0);
    expect(state.auditCalls.length).toBe(0);
  });
});
