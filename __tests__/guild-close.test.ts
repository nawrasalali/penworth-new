/**
 * Unit tests for runMonthlyClose (lib/guild/commissions.ts).
 *
 * Uses an in-memory Supabase fake (see __tests__/helpers/fake-supabase.ts)
 * so these tests are deterministic, fast, and don't touch the production
 * database.
 *
 * Coverage:
 *   - Case A: payout_amount >= $50 → payout created, commissions paid,
 *     fees deducted.
 *   - Case B: 0 < payout_amount < $50 → no payout, everything rolls
 *     forward.
 *   - Case B variant: payout_method unset → no payout regardless of
 *     amount, reason='payout_method_not_set'.
 *   - Case C: payout_amount <= 0 → fee gets fully_deferred, deferred
 *     balance grows.
 *   - Probation trigger: deferred balance > $90 flips active → probation.
 *   - Idempotency: second run for same month returns already_closed=true
 *     and processes zero members.
 *   - Emeritus tier: no fee assessed.
 *   - Pre-fee-start grace period: no fee assessed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runMonthlyClose } from '../lib/guild/commissions';
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase';

const MONTH = '2026-03';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function seedMember(
  fake: FakeSupabase,
  overrides: Partial<{
    id: string;
    tier: string;
    status: string;
    payout_method: string | null;
    account_fee_starts_at: string | null;
  }> = {},
) {
  const row = {
    id: overrides.id || 'member_1',
    tier: overrides.tier ?? 'apprentice',
    status: overrides.status ?? 'active',
    // Use `in` check so callers can pass explicit null to mean "no payout method set"
    payout_method:
      'payout_method' in overrides ? overrides.payout_method : 'wise',
    payout_details_encrypted: 'enc_blob',
    // Default: fees started yesterday (so fees ARE assessed this month)
    account_fee_starts_at:
      'account_fee_starts_at' in overrides
        ? overrides.account_fee_starts_at
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  };
  (fake.state.guild_members ||= { rows: [] }).rows.push(row);
  return row;
}

function seedCommission(
  fake: FakeSupabase,
  memberId: string,
  amount: number,
  opts: { month?: string; qualified?: boolean; status?: string } = {},
) {
  const referralId = `ref_${Math.random().toString(36).slice(2)}`;
  (fake.state.guild_referrals ||= { rows: [] }).rows.push({
    id: referralId,
    status: 'retention_qualified',
    retention_qualified_at: opts.qualified === false ? null : '2026-01-01T00:00:00Z',
  });
  const row = {
    id: `comm_${Math.random().toString(36).slice(2)}`,
    guildmember_id: memberId,
    referral_id: referralId,
    commission_amount_usd: amount,
    commission_month: opts.month || MONTH,
    status: opts.status || 'pending',
    // Embedded join data — matches what the real PostgREST returns
    referral: {
      id: referralId,
      status: 'retention_qualified',
      retention_qualified_at: opts.qualified === false ? null : '2026-01-01T00:00:00Z',
    },
  };
  (fake.state.guild_commissions ||= { rows: [] }).rows.push(row);
  return row;
}

function seedOldDeferredFee(
  fake: FakeSupabase,
  memberId: string,
  amount: number,
  month: string,
) {
  (fake.state.guild_account_fees ||= { rows: [] }).rows.push({
    id: `fee_${month}_${memberId}`,
    guildmember_id: memberId,
    fee_month: month,
    tier_at_time: 'apprentice',
    fee_rate_pct: 20,
    fee_amount_usd: amount,
    amount_deducted_usd: 0,
    amount_deferred_usd: amount,
    amount_waived_usd: 0,
    status: 'fully_deferred',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runMonthlyClose — three-case state machine', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = createFakeSupabase();
  });

  it('Case A: pays out when commission - fee - deferred >= $50', async () => {
    const m = seedMember(fake);
    // 5 commissions × $19 × 20% = $19 total... not enough. Let's give more.
    for (let i = 0; i < 8; i++) {
      seedCommission(fake, m.id, 12); // $96 total
    }

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.already_closed).toBe(false);
    expect(result.payouts_created).toBe(1);
    // $96 locked - $20 fee - $0 deferred = $76 payout
    expect(result.total_paid_usd).toBe(76);
    expect(result.fees_deducted_usd).toBe(20);
    expect(result.probations_triggered).toBe(0);

    // Commissions flipped to 'paid' with payout_id
    const comms = fake.state.guild_commissions.rows;
    expect(comms.every((c) => c.status === 'paid')).toBe(true);
    expect(comms.every((c) => c.payout_id)).toBe(true);

    // Fee row marked fully_deducted
    const fee = fake.state.guild_account_fees.rows[0];
    expect(fee.status).toBe('fully_deducted');
    expect(Number(fee.amount_deducted_usd)).toBe(20);
  });

  it('Case A: resolves older deferred fees against the payout', async () => {
    const m = seedMember(fake);
    // Old deferred fees stacking up
    seedOldDeferredFee(fake, m.id, 20, '2026-01'); // $20 stacked
    seedOldDeferredFee(fake, m.id, 20, '2026-02'); // $20 stacked
    // Big commission this month
    for (let i = 0; i < 10; i++) seedCommission(fake, m.id, 15); // $150

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.payouts_created).toBe(1);
    // $150 - $20 (this month fee) - $40 (old deferred) = $90 payout
    expect(result.total_paid_usd).toBe(90);
    expect(result.fees_deducted_usd).toBe(60); // 20 + 20 + 20 resolved

    // All three fee rows are now fully_deducted
    const fees = fake.state.guild_account_fees.rows;
    expect(fees).toHaveLength(3);
    expect(fees.every((f) => f.status === 'fully_deducted')).toBe(true);
  });

  it('Case B: leaves everything pending when 0 < payout < $50', async () => {
    const m = seedMember(fake);
    // $40 locked commission, $20 fee, $0 deferred → $20 payout (below threshold)
    seedCommission(fake, m.id, 40);

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.payouts_created).toBe(0);
    expect(result.total_paid_usd).toBe(0);

    // Commission stays locked (not paid)
    expect(fake.state.guild_commissions.rows[0].status).toBe('locked');
    expect(fake.state.guild_commissions.rows[0].payout_id).toBeUndefined();

    // Fee row exists and is still pending
    const fee = fake.state.guild_account_fees.rows[0];
    expect(fee.status).toBe('pending');
    expect(Number(fee.amount_deducted_usd)).toBe(0);
    expect(Number(fee.amount_deferred_usd)).toBe(0);
  });

  it('Case B variant: no payout when payout_method not set, even with big commission', async () => {
    const m = seedMember(fake, { payout_method: null });
    for (let i = 0; i < 10; i++) seedCommission(fake, m.id, 20); // $200

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.payouts_created).toBe(0);
    // Commissions got locked but not paid
    expect(fake.state.guild_commissions.rows.every((c) => c.status === 'locked')).toBe(true);
  });

  it('Case C: defers fee and grows deferred balance when commissions < fees', async () => {
    const m = seedMember(fake);
    seedCommission(fake, m.id, 5); // only $5 this month, fee is $20

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.payouts_created).toBe(0);
    expect(result.fees_deferred_usd).toBe(20);

    // Fee row marked fully_deferred
    const fee = fake.state.guild_account_fees.rows[0];
    expect(fee.status).toBe('fully_deferred');
    expect(Number(fee.amount_deferred_usd)).toBe(20);

    // Commission stays locked
    expect(fake.state.guild_commissions.rows[0].status).toBe('locked');
  });

  it('Probation trigger: status flips when deferred balance crosses $90', async () => {
    const m = seedMember(fake);
    // Pre-seed $80 of old deferred fees
    seedOldDeferredFee(fake, m.id, 40, '2026-01');
    seedOldDeferredFee(fake, m.id, 40, '2026-02');
    // No commissions this month → Case C will add another $20 → total $100 deferred

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.probations_triggered).toBe(1);
    const member = fake.state.guild_members.rows[0];
    expect(member.status).toBe('probation');
    expect(member.probation_reason).toBe('deferred_fees_exceed_90');
    expect(member.probation_started_at).toBeTruthy();
  });

  it('Idempotency: second run for the same month returns already_closed and processes nothing', async () => {
    const m = seedMember(fake);
    for (let i = 0; i < 10; i++) seedCommission(fake, m.id, 15);

    const first = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });
    expect(first.already_closed).toBe(false);
    expect(first.payouts_created).toBe(1);

    const second = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });
    expect(second.already_closed).toBe(true);
    expect(second.payouts_created).toBe(0);
    expect(second.members_processed).toBe(0);

    // No duplicate payouts were created
    expect(fake.state.guild_payouts.rows).toHaveLength(1);
  });

  it('Emeritus tier: no fee assessed', async () => {
    const m = seedMember(fake, { tier: 'emeritus' });
    for (let i = 0; i < 5; i++) seedCommission(fake, m.id, 15); // $75

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.fees_assessed_usd).toBe(0);
    // No fee row was created at all
    expect((fake.state.guild_account_fees?.rows || []).length).toBe(0);
    // $75 with $0 fees is fully payable
    expect(result.total_paid_usd).toBe(75);
  });

  it('Pre-fee grace period: no fee assessed before account_fee_starts_at', async () => {
    // Fee start date in the future (new member in grace period)
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const m = seedMember(fake, { account_fee_starts_at: future });
    for (let i = 0; i < 3; i++) seedCommission(fake, m.id, 20); // $60

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.fees_assessed_usd).toBe(0);
    expect(result.total_paid_usd).toBe(60);
  });

  it('Retention-unqualified commissions are NOT locked', async () => {
    const m = seedMember(fake);
    seedCommission(fake, m.id, 19, { qualified: false }); // not yet at 60d
    seedCommission(fake, m.id, 19, { qualified: true });
    seedCommission(fake, m.id, 19, { qualified: true });

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    // Only 2 of the 3 got locked — the unqualified one stays pending
    expect(result.commissions_locked).toBe(2);
    const unqualified = fake.state.guild_commissions.rows.find(
      (c: any) => c.referral.retention_qualified_at === null,
    );
    expect(unqualified?.status).toBe('pending');
  });

  it('Terminated members are excluded entirely', async () => {
    seedMember(fake, { id: 'active_m', status: 'active' });
    seedMember(fake, { id: 'terminated_m', status: 'terminated' });
    for (let i = 0; i < 5; i++) {
      seedCommission(fake, 'active_m', 15);
      seedCommission(fake, 'terminated_m', 15);
    }

    const result = await runMonthlyClose(fake as any, MONTH, { triggeredBy: 'test' });

    expect(result.members_considered).toBe(1);
    // Only the active member was processed
    expect(result.payouts_created).toBe(1);
  });
});
