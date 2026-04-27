/**
 * Unit tests for the auto-replay loop in inngest/functions/stripe-reconcile.ts
 * Step C (CEO-179 + CEO-186 Phase 1).
 *
 * The full Inngest function has four steps (A: summarise, B: drift detect,
 * C: replay, D: alert). Only Step C contains business logic worth testing
 * at unit granularity; A and B are mostly Supabase + Stripe API plumbing.
 *
 * Strategy:
 *   We don't run the full createFunction wrapper — instead we extract the
 *   Step C logic into a stand-alone function shape by mocking the same
 *   collaborators (createServiceClient, processStripeEvent) and invoking
 *   the cron's exported function via a fake step runner that just calls
 *   each step's body inline. This lets us assert on the replay outcome
 *   counters (replayed_ok, replayed_failed, skipped_too_many_retries) and
 *   on which DB rows the replay updated.
 *
 * CEO-186 Phase 1.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// Mock state
// ─────────────────────────────────────────────────────────────────────

interface FailedRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  payload: unknown;
  retry_count: number;
}

interface UpdateRecord {
  id: string;
  values: Record<string, unknown>;
}

const state: {
  failedRows: FailedRow[];
  failedCount: number;
  updates: UpdateRecord[];
  // outcomes map: stripe_event_id → 'ok' | 'throw' | 'unhandled'
  replayBehaviour: Record<string, 'ok' | 'throw' | 'unhandled'>;
  driftMissing: string[];
  alertsEmitted: { args: unknown }[];
} = {
  failedRows: [],
  failedCount: 0,
  updates: [],
  replayBehaviour: {},
  driftMissing: [],
  alertsEmitted: [],
};

// ─────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'update' | null = null;
    let updateValues: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {
      select(_cols?: string, _opts?: unknown) {
        op = 'select';
        return builder;
      },
      update(v: Record<string, unknown>) {
        op = 'update';
        updateValues = v;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        // For .from('stripe_webhook_events').update({...}).eq('id', X)
        // — terminal call that should record the update.
        if (op === 'update' && col === 'id' && table === 'stripe_webhook_events') {
          state.updates.push({ id: val as string, values: { ...updateValues } });
        }
        return builder;
      },
      gte() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      in() {
        return builder;
      },
      then(resolve: (v: unknown) => unknown) {
        if (op === 'select' && table === 'stripe_webhook_events') {
          if (filters.processing_status === 'failed') {
            // Step C: full failed-row fetch with payload.
            return Promise.resolve({
              data: state.failedRows,
              error: null,
              count: state.failedCount,
            }).then(resolve);
          }
        }
        return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      },
    };
    return builder;
  }

  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => makeBuilder(table),
      rpc: vi.fn(async (name: string, args: unknown) => {
        if (name === 'alert_dispatch') {
          state.alertsEmitted.push({ args });
        }
        return { data: null, error: null };
      }),
    })),
  };
});

vi.mock('@/lib/stripe/process-event', () => ({
  processStripeEvent: vi.fn(async (event: unknown) => {
    const evtId = (event as { id?: string }).id ?? '';
    const behaviour = state.replayBehaviour[evtId] ?? 'ok';
    if (behaviour === 'throw') throw new Error(`replay failed for ${evtId}`);
    if (behaviour === 'unhandled') return 'unhandled';
    return 'handled';
  }),
}));

vi.mock('@/lib/stripe/client', () => ({
  // Drift step early-returns when stripe is null; that's fine for unit tests.
  getStripeOrError: vi.fn(() => ({ stripe: null, error: null })),
}));

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_config: unknown, handler: (ctx: unknown) => unknown) => ({
      __handler: handler,
    })),
  },
}));

// ─────────────────────────────────────────────────────────────────────
// Fake step runner — just invokes step bodies inline and returns the
// same shape Inngest's runtime would.
// ─────────────────────────────────────────────────────────────────────

const fakeStep = {
  run: async (_name: string, fn: () => Promise<unknown>) => fn(),
};
const fakeLogger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

// ─────────────────────────────────────────────────────────────────────
// SUT
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line import/first
import { stripeReconcile } from '@/inngest/functions/stripe-reconcile';

async function runReconcile() {
  // The mocked inngest.createFunction stores the handler under __handler.
  const handler = (stripeReconcile as unknown as { __handler: (ctx: unknown) => Promise<unknown> })
    .__handler;
  return handler({ step: fakeStep, logger: fakeLogger });
}

// ─────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv_role_test';
});

beforeEach(() => {
  state.failedRows = [];
  state.failedCount = 0;
  state.updates = [];
  state.replayBehaviour = {};
  state.driftMissing = [];
  state.alertsEmitted = [];
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('stripe-reconcile auto-replay (Step C)', () => {
  it('zero failed rows → no replays attempted, no updates, no alert', async () => {
    const result = (await runReconcile()) as {
      replay: { replayed_ok: number; replayed_failed: number; skipped_too_many_retries: number };
      failed: { failed_count: number };
    };

    expect(result.replay.replayed_ok).toBe(0);
    expect(result.replay.replayed_failed).toBe(0);
    expect(result.replay.skipped_too_many_retries).toBe(0);
    expect(state.updates.length).toBe(0);
    // No actionable signal → no alert
    expect(state.alertsEmitted.length).toBe(0);
  });

  it('5 failed rows, all succeed on replay → 5 replayed_ok, all marked replayed', async () => {
    state.failedCount = 5;
    state.failedRows = Array.from({ length: 5 }).map((_, i) => ({
      id: `row_${i}`,
      stripe_event_id: `evt_${i}`,
      event_type: 'checkout.session.completed',
      payload: { id: `evt_${i}`, type: 'checkout.session.completed' },
      retry_count: 0,
    }));

    const result = (await runReconcile()) as {
      replay: { replayed_ok: number; replayed_failed: number };
      failed: { failed_count: number };
    };

    expect(result.replay.replayed_ok).toBe(5);
    expect(result.replay.replayed_failed).toBe(0);
    expect(state.updates.length).toBe(5);
    for (const u of state.updates) {
      expect(u.values.processing_status).toBe('replayed');
      expect(u.values.error_message).toBe(null);
      expect(u.values.retry_count).toBe(1);
    }
    // Step D still emits because failed_count > 0 (drift signal stale until next run)
    expect(state.alertsEmitted.length).toBe(1);
  });

  it('5 failed rows, 2 throw on replay → 2 retain failed (with error_message), 3 marked replayed', async () => {
    state.failedCount = 5;
    state.failedRows = Array.from({ length: 5 }).map((_, i) => ({
      id: `row_${i}`,
      stripe_event_id: `evt_${i}`,
      event_type: 'checkout.session.completed',
      payload: { id: `evt_${i}`, type: 'checkout.session.completed' },
      retry_count: 0,
    }));
    // First two throw
    state.replayBehaviour['evt_0'] = 'throw';
    state.replayBehaviour['evt_1'] = 'throw';

    const result = (await runReconcile()) as {
      replay: { replayed_ok: number; replayed_failed: number };
    };

    expect(result.replay.replayed_ok).toBe(3);
    expect(result.replay.replayed_failed).toBe(2);
    // Failures: row_0 + row_1 — retry_count bumped, error_message captured, status not flipped
    const fails = state.updates.filter((u) => u.id === 'row_0' || u.id === 'row_1');
    expect(fails.length).toBe(2);
    for (const f of fails) {
      expect(f.values.processing_status).toBeUndefined();
      expect(typeof f.values.error_message).toBe('string');
      expect((f.values.error_message as string).length).toBeGreaterThan(0);
      expect(f.values.retry_count).toBe(1);
    }
    // Alert emitted — replayed_failed > 0
    expect(state.alertsEmitted.length).toBe(1);
  });

  it('row with retry_count=3 is skipped (skipped_too_many_retries++) and never replayed', async () => {
    state.failedCount = 1;
    state.failedRows = [
      {
        id: 'row_exhausted',
        stripe_event_id: 'evt_exhausted',
        event_type: 'invoice.payment_succeeded',
        payload: { id: 'evt_exhausted', type: 'invoice.payment_succeeded' },
        retry_count: 3,
      },
    ];

    const result = (await runReconcile()) as {
      replay: { replayed_ok: number; replayed_failed: number; skipped_too_many_retries: number };
    };

    expect(result.replay.skipped_too_many_retries).toBe(1);
    expect(result.replay.replayed_ok).toBe(0);
    expect(result.replay.replayed_failed).toBe(0);
    // No DB update for skipped rows
    expect(state.updates.length).toBe(0);
    // Alert emitted with high severity (skipped_too_many_retries triggers high)
    expect(state.alertsEmitted.length).toBe(1);
    const alertArgs = state.alertsEmitted[0].args as { p_severity?: string };
    expect(alertArgs.p_severity).toBe('high');
  });

  it('replay returning "unhandled" marks the row as skipped, not replayed', async () => {
    state.failedCount = 1;
    state.failedRows = [
      {
        id: 'row_unhandled',
        stripe_event_id: 'evt_unhandled',
        event_type: 'payment_method.attached',
        payload: { id: 'evt_unhandled', type: 'payment_method.attached' },
        retry_count: 0,
      },
    ];
    state.replayBehaviour['evt_unhandled'] = 'unhandled';

    await runReconcile();

    const updatedRow = state.updates.find((u) => u.id === 'row_unhandled');
    expect(updatedRow?.values.processing_status).toBe('skipped');
    expect(updatedRow?.values.retry_count).toBe(1);
  });
});
