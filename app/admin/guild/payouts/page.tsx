import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import PayoutActions from './PayoutActions';
import MonthFilter from './MonthFilter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guild Payouts — Admin' };

type Status =
  | 'queued'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

const STATUS_FILTERS: Array<{ key: Status | 'all'; label: string }> = [
  { key: 'queued', label: 'Queued' },
  { key: 'approved', label: 'Approved' },
  { key: 'processing', label: 'Processing' },
  { key: 'sent', label: 'Sent' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

interface QueueRow {
  payout_id: string;
  payout_month: string;
  amount_usd: string | number;
  fee_usd: string | number;
  net_amount_usd: string | number;
  method: 'wise' | 'usdt';
  destination_masked: string;
  reference_number: string | null;
  status: Status;
  failure_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  statement_pdf_url: string | null;
  queued_at: string;
  last_updated_at: string;
  guildmember_id: string;
  user_id: string;
  display_name: string;
  tier: string;
  member_status: string;
  primary_market: string | null;
  primary_language: string;
  referral_code: string;
  tax_residency: string | null;
  member_email: string | null;
}

function fmtUsd(n: string | number): string {
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return `$${v.toFixed(2)}`;
}

function statusBadge(status: Status): string {
  const map: Record<Status, string> = {
    queued: 'bg-amber-100 text-amber-800 border-amber-200',
    approved: 'bg-blue-100 text-blue-800 border-blue-200',
    processing: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    sent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    confirmed: 'bg-emerald-600 text-white border-emerald-700',
    failed: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  };
  return map[status];
}

export default async function AdminGuildPayoutsPage(
  props: {
    searchParams: Promise<{ status?: string; month?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // The /admin layout already enforces is_admin — no need to re-check here.
  const admin = createServiceClient();

  const statusFilter = (searchParams.status as Status | 'all') || 'queued';
  const monthFilter = searchParams.month || null; // YYYY-MM

  let query = admin
    .from('v_guild_monthly_payout_queue')
    .select('*')
    .order('payout_month', { ascending: false })
    .order('amount_usd', { ascending: false })
    .limit(500);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }
  if (monthFilter) {
    query = query.eq('payout_month', monthFilter);
  }

  const { data, error } = await query;
  const rows = (data as QueueRow[] | null) ?? [];

  // Aggregate by status for the filter pills (all months, for an overall view)
  const { data: statusCountsData } = await admin
    .from('v_guild_monthly_payout_queue')
    .select('status');
  const counts: Record<string, number> = { all: 0 };
  (statusCountsData ?? []).forEach((r: any) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
    counts.all += 1;
  });

  // Totals on the currently-filtered set
  const pageTotalUsd = rows.reduce(
    (sum, r) => sum + Number(r.amount_usd || 0),
    0,
  );
  const pageNetUsd = rows.reduce(
    (sum, r) => sum + Number(r.net_amount_usd || 0),
    0,
  );

  // Month options — distinct payout_months from the view
  const { data: monthsData } = await admin
    .from('v_guild_monthly_payout_queue')
    .select('payout_month')
    .order('payout_month', { ascending: false });
  const monthsSet = new Set<string>();
  (monthsData ?? []).forEach((r: any) => monthsSet.add(r.payout_month));
  const months = Array.from(monthsSet);

  return (
    <div className="px-8 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Guild Payouts
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Monthly payout queue. Approve, mark sent, or flag failed payments.
            Amounts are already aggregated by month-close; $50 minimum was
            enforced at queue time.
          </p>
        </div>
        <Link
          href="/admin/guild"
          className="text-sm text-neutral-600 hover:text-neutral-900"
        >
          ← Guild admin
        </Link>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load payouts: {error.message}
          {error.message.includes('v_guild_monthly_payout_queue') && (
            <div className="mt-1 text-xs">
              Run migration <code>011_guild_payout_queue_view.sql</code> first.
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <SummaryCard
          label="Payouts in view"
          value={rows.length.toString()}
          sub={`of ${counts.all ?? 0} total`}
        />
        <SummaryCard label="Gross (view)" value={fmtUsd(pageTotalUsd)} />
        <SummaryCard label="Net (view)" value={fmtUsd(pageNetUsd)} />
        <SummaryCard
          label="Queued (all months)"
          value={(counts.queued ?? 0).toString()}
          accent={counts.queued > 0 ? 'amber' : undefined}
        />
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          const query = new URLSearchParams();
          query.set('status', f.key);
          if (monthFilter) query.set('month', monthFilter);
          return (
            <Link
              key={f.key}
              href={`/admin/guild/payouts?${query.toString()}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400'
              }`}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] > 0 && (
                <span className="ml-1.5 opacity-70">({counts[f.key]})</span>
              )}
            </Link>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-neutral-500">Month:</span>
          <MonthFilter months={months} />
        </div>
      </div>

      {/* Payouts table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="px-4 py-2.5 text-left">Month</th>
              <th className="px-4 py-2.5 text-left">Member</th>
              <th className="px-4 py-2.5 text-left">Tier</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
              <th className="px-4 py-2.5 text-right">Net</th>
              <th className="px-4 py-2.5 text-left">Method</th>
              <th className="px-4 py-2.5 text-left">Destination</th>
              <th className="px-4 py-2.5 text-left">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 && !error && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-10 text-center text-sm text-neutral-500"
                >
                  No payouts match the current filter.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.payout_id} className="hover:bg-neutral-50">
                <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                  {row.payout_month}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-neutral-900">
                    {row.display_name}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {row.member_email ?? '—'}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    {row.referral_code}
                    {row.primary_market && ` · ${row.primary_market}`}
                    {row.tax_residency && ` · tax: ${row.tax_residency}`}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs capitalize text-neutral-700">
                  {row.tier}
                  {row.member_status !== 'active' && (
                    <div className="text-[10px] uppercase text-red-600">
                      {row.member_status}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-neutral-900">
                  {fmtUsd(row.amount_usd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-neutral-700">
                  {fmtUsd(row.net_amount_usd)}
                  {Number(row.fee_usd) > 0 && (
                    <div className="text-[10px] text-neutral-400">
                      fee {fmtUsd(row.fee_usd)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs font-medium uppercase text-neutral-700">
                  {row.method}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                  {row.destination_masked}
                  {row.reference_number && (
                    <div className="text-[10px] text-neutral-400">
                      ref: {row.reference_number}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadge(
                      row.status,
                    )}`}
                  >
                    {row.status}
                  </span>
                  {row.failure_reason && (
                    <div className="mt-1 max-w-xs text-[10px] text-red-700">
                      {row.failure_reason}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <PayoutActions
                    payoutId={row.payout_id}
                    currentStatus={row.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'amber' | 'red';
}) {
  const accentClass =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'red'
        ? 'text-red-700'
        : 'text-neutral-900';
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accentClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
