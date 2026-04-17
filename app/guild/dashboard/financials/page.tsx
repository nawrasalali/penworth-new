import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Financials',
};

export default async function FinancialsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/guild/login?redirect=/guild/dashboard/financials');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Load commission events (most recent 100)
  const { data: commissions } = await admin
    .from('guild_commissions')
    .select(`
      id, commission_amount_usd, commission_rate, subscription_price_usd,
      commission_month, status, earned_at, paid_at, clawback_reason,
      referral:guild_referrals!inner(
        id, tier_at_referral, first_plan, signup_country,
        referred_user:auth.users!inner(email)
      )
    `)
    .eq('guildmember_id', member.id)
    .order('earned_at', { ascending: false })
    .limit(100);

  // Summaries
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: allCommissions } = await admin
    .from('guild_commissions')
    .select('commission_amount_usd, status, commission_month, earned_at')
    .eq('guildmember_id', member.id);

  const stats = computeStats(allCommissions || [], currentMonth);

  // Payouts
  const { data: payouts } = await admin
    .from('guild_payouts')
    .select('payout_month, amount_usd, net_amount_usd, method, status, sent_at')
    .eq('guildmember_id', member.id)
    .order('payout_month', { ascending: false })
    .limit(24);

  // Active referrals count
  const { count: activeReferralsCount } = await admin
    .from('guild_referrals')
    .select('*', { count: 'exact', head: true })
    .eq('guildmember_id', member.id)
    .in('status', ['active_paid', 'retention_qualified']);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <NavBreadcrumbs />

      <div className="mt-6 mb-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Your Financials
        </div>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">Ledger & Earnings</h1>
        <p className="mt-2 text-sm text-[#8a8370]">
          Every commission event, every payout, every dollar tracked.
        </p>
      </div>

      {/* Top summary row */}
      <div className="grid gap-4 md:grid-cols-5">
        <SummaryCard title="Lifetime earnings" value={formatUSD(stats.lifetimePaid + stats.lifetimePending)} highlight />
        <SummaryCard title="This month" value={formatUSD(stats.currentMonthTotal)} />
        <SummaryCard title="Pending retention" value={formatUSD(stats.lifetimePending)} muted />
        <SummaryCard title="Active referrals" value={String(activeReferralsCount || 0)} />
        <SummaryCard title="Lifetime paid out" value={formatUSD(stats.lifetimePaid)} />
      </div>

      {/* Payout method warning */}
      {member.payout_method === 'pending' && (
        <div className="mt-8 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-5 text-sm text-yellow-200">
          <strong className="text-yellow-300">⚠ Payout method not set.</strong> Your earnings are accruing, but
          they can&apos;t be paid out until you configure Wise or USDT in{' '}
          <Link href="/guild/dashboard/settings" className="underline">
            settings
          </Link>
          .
        </div>
      )}

      {/* The ledger */}
      <div className="mt-12 rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-2xl tracking-tight">Commission Ledger</h2>
          <div className="text-xs text-[#8a8370]">Showing last 100 events</div>
        </div>

        {!commissions || commissions.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8a8370]">
            No commission events yet. Your first referral&apos;s subscription will create the first entry here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-[#6b6452]">
                <tr className="border-b border-[#1e2436]">
                  <th className="pb-3 text-left font-normal">Date</th>
                  <th className="pb-3 text-left font-normal">Referral</th>
                  <th className="pb-3 text-left font-normal">Plan</th>
                  <th className="pb-3 text-right font-normal">Rate</th>
                  <th className="pb-3 text-right font-normal">Amount</th>
                  <th className="pb-3 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c: any) => (
                  <tr key={c.id} className="border-b border-[#1e2436]/50">
                    <td className="py-3 text-[#c9c2b0]">
                      {new Date(c.earned_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="py-3 text-[#c9c2b0]">
                      <MaskedEmail email={c.referral?.referred_user?.email || ''} />
                      {c.referral?.signup_country && (
                        <span className="ml-2 text-xs text-[#6b6452]">
                          ({c.referral.signup_country})
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-[#c9c2b0]">{c.referral?.first_plan || '—'}</td>
                    <td className="py-3 text-right text-[#c9c2b0]">
                      {(Number(c.commission_rate) * 100).toFixed(0)}%
                    </td>
                    <td
                      className={`py-3 text-right font-serif ${
                        c.status === 'clawed_back' ? 'text-red-400 line-through' : 'text-[#d4af37]'
                      }`}
                    >
                      {c.status === 'clawed_back' ? '-' : ''}
                      {formatUSD(Number(c.commission_amount_usd))}
                    </td>
                    <td className="py-3 text-right">
                      <CommissionStatus status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payout history */}
      <div className="mt-8 rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-serif text-2xl tracking-tight">Payout History</h2>
          <div className="text-xs text-[#8a8370]">{payouts?.length || 0} payouts</div>
        </div>

        {!payouts || payouts.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8a8370]">
            No payouts yet. Your first payout will be processed on the last business day of the month where your locked earnings exceed $50.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-[#6b6452]">
                <tr className="border-b border-[#1e2436]">
                  <th className="pb-3 text-left font-normal">Month</th>
                  <th className="pb-3 text-left font-normal">Method</th>
                  <th className="pb-3 text-right font-normal">Gross</th>
                  <th className="pb-3 text-right font-normal">Net paid</th>
                  <th className="pb-3 text-right font-normal">Status</th>
                  <th className="pb-3 text-right font-normal">Sent</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p: any) => (
                  <tr key={p.payout_month} className="border-b border-[#1e2436]/50">
                    <td className="py-3 text-[#c9c2b0]">{formatMonth(p.payout_month)}</td>
                    <td className="py-3 uppercase text-[#c9c2b0]">{p.method}</td>
                    <td className="py-3 text-right text-[#c9c2b0]">
                      {formatUSD(Number(p.amount_usd))}
                    </td>
                    <td className="py-3 text-right font-serif text-[#d4af37]">
                      {formatUSD(Number(p.net_amount_usd))}
                    </td>
                    <td className="py-3 text-right">
                      <PayoutStatus status={p.status} />
                    </td>
                    <td className="py-3 text-right text-[#8a8370]">
                      {p.sent_at
                        ? new Date(p.sent_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mt-12 rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-6 text-sm text-[#8a8370]">
        <strong className="text-[#c9c2b0]">How this works:</strong> Commissions are earned when your referred
        users pay their subscription. They become <em className="text-[#d4af37] not-italic">pending</em> for
        60 days to ensure retention. After 60 days they become <em className="text-[#8fbc8f] not-italic">locked</em>{' '}
        and will be included in the next monthly payout. Payouts are sent on the last business day of each month
        to the Wise or USDT destination you&apos;ve configured, with a $50 minimum. Refunds from Penworth clawback
        the affected commission.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NavBreadcrumbs() {
  return (
    <div className="flex items-center gap-2 text-xs text-[#6b6452]">
      <Link href="/guild/dashboard" className="hover:text-[#c9c2b0]">
        Dashboard
      </Link>
      <span>→</span>
      <span className="text-[#c9c2b0]">Financials</span>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  highlight,
  muted,
}: {
  title: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        highlight
          ? 'border-[#d4af37]/40 bg-[#d4af37]/5'
          : 'border-[#1e2436] bg-[#0f1424]'
      }`}
    >
      <div className="text-xs uppercase tracking-widest text-[#8a8370]">{title}</div>
      <div
        className={`mt-2 font-serif text-3xl tracking-tight ${
          highlight ? 'text-[#d4af37]' : muted ? 'text-[#8a8370]' : 'text-[#e7e2d4]'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function CommissionStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    pending:     { label: 'Pending (60d)', class: 'bg-yellow-500/10 text-yellow-400' },
    locked:      { label: 'Locked',         class: 'bg-green-500/10 text-green-400' },
    paid:        { label: 'Paid',           class: 'bg-blue-500/10 text-blue-400' },
    clawed_back: { label: 'Clawed back',    class: 'bg-red-500/10 text-red-400' },
  };
  const info = map[status] || { label: status, class: 'bg-gray-500/10 text-gray-400' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${info.class}`}>{info.label}</span>
  );
}

function PayoutStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    queued:     { label: 'Queued',     class: 'bg-yellow-500/10 text-yellow-400' },
    approved:   { label: 'Approved',   class: 'bg-blue-500/10 text-blue-400' },
    processing: { label: 'Processing', class: 'bg-blue-500/10 text-blue-400' },
    sent:       { label: 'Sent',       class: 'bg-green-500/10 text-green-400' },
    confirmed:  { label: 'Confirmed',  class: 'bg-green-500/10 text-green-400' },
    failed:     { label: 'Failed',     class: 'bg-red-500/10 text-red-400' },
    cancelled:  { label: 'Cancelled',  class: 'bg-gray-500/10 text-gray-400' },
  };
  const info = map[status] || { label: status, class: 'bg-gray-500/10 text-gray-400' };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${info.class}`}>{info.label}</span>;
}

function MaskedEmail({ email }: { email: string }) {
  if (!email) return <span className="text-[#6b6452]">—</span>;
  const [local, domain] = email.split('@');
  if (!local || !domain) return <span className="text-[#6b6452]">—</span>;
  const masked =
    local.length <= 2
      ? local[0] + '*'
      : local.slice(0, 2) + '***';
  return (
    <span className="font-mono text-xs">
      {masked}@{domain}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

function computeStats(
  commissions: Array<{
    commission_amount_usd: number | string;
    status: string;
    commission_month: string;
    earned_at: string;
  }>,
  currentMonth: string,
) {
  let lifetimePaid = 0;
  let lifetimePending = 0;
  let currentMonthTotal = 0;

  for (const c of commissions) {
    const amount = Number(c.commission_amount_usd);
    if (c.status === 'clawed_back') continue;
    if (c.status === 'paid') {
      lifetimePaid += amount;
    } else {
      lifetimePending += amount;
    }
    if (c.commission_month === currentMonth && c.status !== 'clawed_back') {
      currentMonthTotal += amount;
    }
  }

  return { lifetimePaid, lifetimePending, currentMonthTotal };
}

function formatUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}
