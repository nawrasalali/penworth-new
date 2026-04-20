/**
 * Phase 2.5 Item 3 Phase B — Tier 2 tool handler tests.
 *
 * Each tool has its own describe() block. Tests cover:
 *   - Surface gate (author-only) rejection
 *   - Happy path (mocked external calls + undo token emission)
 *   - Input validation rejections
 *   - is_reverse flag suppressing undo-token emission
 *   - missing forward_turn_id graceful failure
 *
 * Mocks are inline per-test — we assert call shape + returned envelope
 * without standing up the full fake-supabase state machine. The handler
 * logic is straightforward enough that a call-spying approach is
 * strictly clearer for what each test proves than a simulated DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoraContext, NoraToolContext } from '@/lib/nora/types';

// -----------------------------------------------------------------------------
// Module-level mocks — set before imports run.
// -----------------------------------------------------------------------------

// Supabase service client — the shape varies by tool; each test configures
// the return value of createServiceClient via `mockServiceClient`.
let mockServiceClient: any = null;
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockServiceClient,
}));

// Stripe — same pattern. Only pause_subscription uses it; other tests
// leave mockStripe null.
let mockStripe: any = null;
vi.mock('@/lib/stripe/client', () => ({
  getStripeOrError: () =>
    mockStripe ? { stripe: mockStripe } : { error: new Error('stripe not configured') },
}));

// Now import the tools — mocks above are hoisted by vitest.
import { changeEmailTool } from '@/lib/nora/tools/change-email';
import { adjustCreditsSmallTool } from '@/lib/nora/tools/adjust-credits-small';
import { pauseSubscriptionTool } from '@/lib/nora/tools/pause-subscription';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const AUTHOR_CTX: NoraContext = {
  user_id: '00000000-0000-0000-0000-000000000001',
  email: 'old@example.com',
  primary_language: 'en',
  full_name: 'Test Author',
  plan: 'free',
  is_admin: false,
  credits_balance: 1_000_000,
  account_created_at: '2026-01-01T00:00:00Z',
  surface: 'author',
  user_role: 'author_free',
  guildmember_id: null,
  tier: null,
  guild_status: null,
  referral_code: null,
  guild_joined_at: null,
  primary_market: null,
  account_fee_starts_at: null,
  fee_window_active: null,
  probation_started_at: null,
  probation_reason: null,
  deferred_balance_usd: null,
  current_monthly_fee_usd: null,
  total_referrals: null,
  retained_referrals: null,
  referrals_in_gate_window: null,
  last_payout: null,
  pending_commission_usd: null,
  unused_grants: null,
  unused_grant_categories: null,
  // Handlers under test don't read any of the mentor/analytics fields.
  // Widening via `unknown` keeps the fixture focused on what matters.
} as unknown as NoraContext;

const GUILD_CTX: NoraContext = {
  ...AUTHOR_CTX,
  surface: 'guild',
  user_role: 'guildmember_active',
} as unknown as NoraContext;

function buildToolCtx(overrides: Partial<NoraToolContext> = {}): NoraToolContext {
  return {
    member: AUTHOR_CTX,
    conversation_id: '00000000-0000-0000-0000-000000000002',
    matched_pattern: null,
    forward_turn_id: '00000000-0000-0000-0000-000000000003',
    ...overrides,
  };
}

beforeEach(() => {
  mockServiceClient = null;
  mockStripe = null;
});

// =============================================================================
// change_email
// =============================================================================

describe('change_email tool', () => {
  it('rejects non-author surface', async () => {
    // No mock set — guard should fire before any DB call.
    const result = await changeEmailTool.handler(
      { new_email: 'new@example.com' },
      buildToolCtx({ member: GUILD_CTX }),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('tier_2_not_available_on_surface');
  });

  it('happy path: calls updateUserById + emits undo token', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const insertedTokenId = '00000000-0000-0000-0000-00000000aaaa';
    const insert = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: { id: insertedTokenId }, error: null }),
      }),
    }));

    mockServiceClient = {
      auth: { admin: { updateUserById } },
      from: vi.fn(() => ({ insert })),
    };

    const result = await changeEmailTool.handler(
      { new_email: 'new@example.com' },
      buildToolCtx(),
    );

    expect(result.ok).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(
      AUTHOR_CTX.user_id,
      { email: 'new@example.com' },
    );
    // The undo token INSERT happens via a second createServiceClient() call
    // inside insertUndoToken — since our mock returns the same client both
    // times, the from() spy captures both. Assert the token INSERT
    // happened by checking we hit 'nora_tool_undo_tokens'.
    expect(mockServiceClient.from).toHaveBeenCalledWith('nora_tool_undo_tokens');
    expect(result.data).toMatchObject({
      old_email: AUTHOR_CTX.email,
      new_email: 'new@example.com',
      undo_token_id: insertedTokenId,
      is_reverse: false,
    });
    expect(result.message_for_user).toContain('undo');
  });

  it('rejects invalid email format', async () => {
    // No mock needed — validation fires before any DB call.
    const result = await changeEmailTool.handler(
      { new_email: 'not-an-email' },
      buildToolCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('invalid_new_email');
  });

  it('rejects new_email equal to current email', async () => {
    const result = await changeEmailTool.handler(
      { new_email: AUTHOR_CTX.email },
      buildToolCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('new_email_equals_old');
  });

  it('is_reverse=true suppresses undo token emission', async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const fromSpy = vi.fn();
    mockServiceClient = {
      auth: { admin: { updateUserById } },
      from: fromSpy,
    };

    const result = await changeEmailTool.handler(
      { new_email: 'old-was@example.com', is_reverse: true },
      buildToolCtx(),
    );

    expect(result.ok).toBe(true);
    expect(updateUserById).toHaveBeenCalled();
    // No undo token INSERT on reverse — from() should never have been
    // called with 'nora_tool_undo_tokens'.
    const tokenInsertCalls = fromSpy.mock.calls.filter(
      (c) => c[0] === 'nora_tool_undo_tokens',
    );
    expect(tokenInsertCalls).toHaveLength(0);
    // Also: message should NOT contain the undo affordance.
    expect(result.message_for_user).not.toContain('60 minutes');
  });
});

// =============================================================================
// adjust_credits_small
// =============================================================================

describe('adjust_credits_small tool', () => {
  it('rejects non-author surface', async () => {
    const result = await adjustCreditsSmallTool.handler(
      { delta: 100, reason: 'support compensation' },
      buildToolCtx({ member: GUILD_CTX }),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('tier_2_not_available_on_surface');
  });

  it('rejects delta=0', async () => {
    const result = await adjustCreditsSmallTool.handler(
      { delta: 0, reason: 'no reason' },
      buildToolCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('delta_out_of_bounds');
  });

  it('rejects delta out of [-1000, 1000] bounds', async () => {
    const resultHigh = await adjustCreditsSmallTool.handler(
      { delta: 1001, reason: 'too big' },
      buildToolCtx(),
    );
    expect(resultHigh.ok).toBe(false);
    expect(resultHigh.failure_reason).toBe('delta_out_of_bounds');

    const resultLow = await adjustCreditsSmallTool.handler(
      { delta: -5000, reason: 'too negative' },
      buildToolCtx(),
    );
    expect(resultLow.ok).toBe(false);
    expect(resultLow.failure_reason).toBe('delta_out_of_bounds');
  });

  it('rejects missing reason', async () => {
    const result = await adjustCreditsSmallTool.handler(
      { delta: 100, reason: '' },
      buildToolCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('reason_required');
  });

  it('rejects when forward_turn_id is empty (would FK-violate the RPC)', async () => {
    // Rate-limit check needs to not block us — return empty conv list.
    mockServiceClient = buildAdjustMock({
      conversations: [],
      rpcResponse: { data: null, error: null },
    });
    const result = await adjustCreditsSmallTool.handler(
      { delta: 100, reason: 'support comp' },
      buildToolCtx({ forward_turn_id: '' }),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('missing_forward_turn_id');
  });

  it('happy path: calls RPC with correct args + returns envelope', async () => {
    const rpcResponse = {
      data: {
        success: true,
        delta_applied: 200,
        previous_credits_balance: 1_000_000,
        new_credits_balance: 1_000_200,
        credit_transaction_id: '00000000-0000-0000-0000-00000000ccc1',
        undo_token_id: '00000000-0000-0000-0000-00000000ccc2',
        undo_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      error: null,
    };
    const rpc = vi.fn().mockResolvedValue(rpcResponse);
    mockServiceClient = buildAdjustMock({
      conversations: [], // no prior conversations → rate limit passes
      rpcFn: rpc,
    });

    const result = await adjustCreditsSmallTool.handler(
      { delta: 200, reason: 'compensating for failed book generation' },
      buildToolCtx(),
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'nora_adjust_credits_and_record_undo',
      expect.objectContaining({
        p_user_id: AUTHOR_CTX.user_id,
        p_delta: 200,
        p_reason: 'compensating for failed book generation',
        p_conversation_id: '00000000-0000-0000-0000-000000000002',
        p_forward_turn_id: '00000000-0000-0000-0000-000000000003',
        p_reverse_payload: expect.objectContaining({
          tool_name: 'adjust_credits_small',
          tool_input: expect.objectContaining({ delta: -200 }),
        }),
      }),
    );
    expect(result.data).toMatchObject({
      delta_applied: 200,
      new_credits_balance: 1_000_200,
      undo_token_id: '00000000-0000-0000-0000-00000000ccc2',
      is_reverse: false,
    });
    expect(result.message_for_user).toContain('200 credits');
    expect(result.message_for_user).toContain('1,000,200');
  });

  it('rate-limits second forward call within 24h', async () => {
    // Simulate: one prior conversation exists, and the nora_turns count
    // for adjust_credits_small tool_call rows in the last 24h is >= 2
    // (prior call + the tool_call row the turn route just inserted for
    // THIS invocation).
    mockServiceClient = buildAdjustMock({
      conversations: [{ id: 'conv-prior' }],
      turnCount: 2,
    });

    const result = await adjustCreditsSmallTool.handler(
      { delta: 100, reason: 'second attempt' },
      buildToolCtx(),
    );

    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('rate_limited_24h');
  });

  it('is_reverse=true bypasses the rate limit', async () => {
    // Even if the count says we're over, is_reverse skips the check.
    const rpcResponse = {
      data: {
        success: true,
        delta_applied: -200,
        previous_credits_balance: 1_000_200,
        new_credits_balance: 1_000_000,
        credit_transaction_id: '00000000-0000-0000-0000-00000000dddd',
        undo_token_id: '00000000-0000-0000-0000-00000000eeee',
        undo_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      error: null,
    };
    const rpc = vi.fn().mockResolvedValue(rpcResponse);
    mockServiceClient = buildAdjustMock({
      conversations: [{ id: 'conv-prior' }],
      turnCount: 99, // would rate-limit if not bypassed
      rpcFn: rpc,
    });

    const result = await adjustCreditsSmallTool.handler(
      { delta: -200, reason: 'reverse of: compensating for failed book', is_reverse: true },
      buildToolCtx(),
    );

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalled();
    // Reverse message has no undo affordance.
    expect(result.message_for_user).not.toContain('60 minutes');
    expect(result.data).toMatchObject({ is_reverse: true });
  });
});

// =============================================================================
// pause_subscription
// =============================================================================

describe('pause_subscription tool', () => {
  it('rejects non-author surface', async () => {
    const result = await pauseSubscriptionTool.handler(
      {},
      buildToolCtx({ member: GUILD_CTX }),
    );
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('tier_2_not_available_on_surface');
  });

  it('rejects when user has no active Stripe subscription', async () => {
    mockServiceClient = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                {
                  organizations: {
                    id: 'org-1',
                    name: 'Acme',
                    stripe_subscription_id: null,
                    subscription_tier: 'free',
                  },
                },
              ],
              error: null,
            }),
          }),
        }),
      })),
    };
    const result = await pauseSubscriptionTool.handler({}, buildToolCtx());
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toBe('no_active_subscription');
  });

  it('happy path pause: calls Stripe update with pause_collection void + emits token', async () => {
    const stripeUpdate = vi.fn().mockResolvedValue({ id: 'sub_123' });
    mockStripe = { subscriptions: { update: stripeUpdate } };

    const insertedTokenId = '00000000-0000-0000-0000-0000000000ff';
    mockServiceClient = buildPauseMock({
      subscriptionId: 'sub_123',
      orgName: 'Acme',
      insertedTokenId,
    });

    const result = await pauseSubscriptionTool.handler({}, buildToolCtx());

    expect(result.ok).toBe(true);
    expect(stripeUpdate).toHaveBeenCalledWith('sub_123', {
      pause_collection: { behavior: 'void' },
    });
    expect(result.data).toMatchObject({
      intent: 'pause',
      is_reverse: false,
      undo_token_id: insertedTokenId,
      org_name: 'Acme',
    });
    expect(result.message_for_user).toContain('undo');
  });

  it('reverse (resume): calls Stripe update with pause_collection null, no undo token', async () => {
    const stripeUpdate = vi.fn().mockResolvedValue({ id: 'sub_123' });
    mockStripe = { subscriptions: { update: stripeUpdate } };

    const fromSpy = vi.fn((table: string) => {
      if (table === 'org_members') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [
                  {
                    organizations: {
                      id: 'org-1',
                      name: 'Acme',
                      stripe_subscription_id: 'sub_123',
                      subscription_tier: 'pro',
                    },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table access on reverse: ${table}`);
    });
    mockServiceClient = { from: fromSpy };

    const result = await pauseSubscriptionTool.handler(
      { resume: true, is_reverse: true },
      buildToolCtx(),
    );

    expect(result.ok).toBe(true);
    expect(stripeUpdate).toHaveBeenCalledWith('sub_123', {
      pause_collection: null,
    });
    expect(result.data).toMatchObject({ intent: 'resume', is_reverse: true });
    // No nora_tool_undo_tokens INSERT on reverse.
    expect(fromSpy).not.toHaveBeenCalledWith('nora_tool_undo_tokens');
    // Message has no undo affordance on reverse.
    expect(result.message_for_user).not.toContain('60 minutes');
  });

  it('surfaces Stripe failure with a user-friendly message', async () => {
    mockStripe = {
      subscriptions: {
        update: vi.fn().mockRejectedValue(new Error('No such subscription: sub_123')),
      },
    };
    mockServiceClient = buildPauseMock({
      subscriptionId: 'sub_123',
      orgName: 'Acme',
      insertedTokenId: 'unused',
    });

    const result = await pauseSubscriptionTool.handler({}, buildToolCtx());
    expect(result.ok).toBe(false);
    expect(result.failure_reason).toContain('stripe update error');
    expect(result.message_for_user).toContain('ticket');
  });
});

// -----------------------------------------------------------------------------
// Mock builders — keep tests readable by hiding the query-builder chains.
// -----------------------------------------------------------------------------

/**
 * Builds a mockServiceClient for adjust_credits_small tests.
 *
 * Configures:
 *   - nora_conversations select → returns `conversations` list
 *   - nora_turns select+count   → returns `turnCount`
 *   - rpc('nora_adjust_...')    → returns `rpcFn`'s result if provided,
 *                                 else rpcResponse
 *   - nora_tool_undo_tokens update → no-op { error: null }
 */
function buildAdjustMock(args: {
  conversations: Array<{ id: string }>;
  turnCount?: number;
  rpcResponse?: { data: any; error: any };
  rpcFn?: ReturnType<typeof vi.fn>;
}): any {
  const convs = args.conversations;
  const turnCount = args.turnCount ?? 0;
  const rpcFn =
    args.rpcFn ?? vi.fn().mockResolvedValue(args.rpcResponse ?? { data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === 'nora_conversations') {
      return {
        select: () => ({
          eq: () => ({
            gt: async () => ({ data: convs, error: null }),
          }),
        }),
      };
    }
    if (table === 'nora_turns') {
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              eq: () => ({
                gt: async () => ({ count: turnCount, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'nora_tool_undo_tokens') {
      return {
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    }
    throw new Error(`unexpected table access in adjust mock: ${table}`);
  });

  return { from, rpc: rpcFn };
}

/**
 * Builds a mockServiceClient for pause_subscription forward-path tests.
 */
function buildPauseMock(args: {
  subscriptionId: string;
  orgName: string;
  insertedTokenId: string;
}): any {
  return {
    from: vi.fn((table: string) => {
      if (table === 'org_members') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [
                  {
                    organizations: {
                      id: 'org-1',
                      name: args.orgName,
                      stripe_subscription_id: args.subscriptionId,
                      subscription_tier: 'pro',
                    },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'nora_tool_undo_tokens') {
        return {
          insert: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: { id: args.insertedTokenId },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table access in pause mock: ${table}`);
    }),
  };
}
