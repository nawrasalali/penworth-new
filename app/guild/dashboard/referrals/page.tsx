import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import CopyButton from '@/components/guild/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My Referrals',
};

export default async function ReferralsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/guild/login?redirect=/guild/dashboard/referrals');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) redirect('/guild/dashboard');

  // Load all referrals
  const { data: referrals } = await admin
    .from('guild_referrals')
    .select(`
      id, status, tier_at_referral, commission_rate_locked,
      signed_up_at, first_paid_at, first_plan, first_plan_price_usd,
      commission_window_ends_at, retention_qualified_at, cancelled_at,
      total_commission_earned_usd, signup_country,
      referred_user:auth.users!inner(email)
    `)
    .eq('guildmember_id', member.id)
    .order('signed_up_at', { ascending: false });

  const stats = {
    total: referrals?.length || 0,
    paid: referrals?.filter((r: any) => ['active_paid', 'retention_qualified'].includes(r.status)).length || 0,
    retained: referrals?.filter((r: any) => r.status === 'retention_qualified').length || 0,
    cancelled: referrals?.filter((r: any) => ['cancelled', 'refunded'].includes(r.status)).length || 0,
  };

  const retentionRate =
    stats.total > 0 ? Math.round((stats.retained / Math.max(1, stats.paid)) * 100) : 0;

  const referralUrl = `https://penworth.ai?ref=${member.referral_code}`;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <NavBreadcrumbs />

      <div className="mt-6 mb-10">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Your Referrals
        </div>
        <h1 className="mt-2 font-serif text-4xl tracking-tight">The people you&apos;ve introduced.</h1>
        <p className="mt-2 text-sm text-[#8a8370]">
          Every author who reached Penworth through you. Attribution is permanent.
        </p>
      </div>

      {/* Referral link banner */}
      <div className="mb-10 rounded-xl border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/10 to-transparent p-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          Your Referral Link
        </div>
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
          <code className="flex-1 rounded-md bg-[#0a0e1a] px-4 py-3 font-mono text-sm text-[#e7e2d4]">
            {referralUrl}
          </code>
          <CopyButton text={referralUrl} />
        </div>
        <div className="mt-4 text-xs text-[#8a8370]">
          Your code:{' '}
          <code className="rounded bg-[#1e2436] px-2 py-0.5 font-mono text-[#d4af37]">
            {member.referral_code}
          </code>{' '}
          · Share as a link, or tell people to enter the code manually during signup
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-10 grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard label="Total referrals" value={String(stats.total)} />
        <StatCard label="Currently paying" value={String(stats.paid)} highlight />
        <StatCard label="60-day retained" value={String(stats.retained)} />
        <StatCard label="Retention rate" value={`${retentionRate}%`} suffix="of paying" />
      </div>

      {/* List */}
      <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
        {!referrals || referrals.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-4 text-4xl">🌱</div>
            <h3 className="font-serif text-2xl tracking-tight">No referrals yet</h3>
            <p className="mx-auto mt-3 max-w-md text-sm text-[#8a8370]">
              Share your link with people in your world who have a book in them. Your first
              referral will appear here within minutes of their signup.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-[#6b6452]">
                <tr className="border-b border-[#1e2436]">
                  <th className="pb-3 text-left font-normal">Referred</th>
                  <th className="pb-3 text-left font-normal">Signed up</th>
                  <th className="pb-3 text-left font-normal">Plan</th>
                  <th className="pb-3 text-left font-normal">Status</th>
                  <th className="pb-3 text-right font-normal">Rate</th>
                  <th className="pb-3 text-right font-normal">Earned</th>
                  <th className="pb-3 text-right font-normal">Window ends</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r: any) => (
                  <tr key={r.id} className="border-b border-[#1e2436]/50">
                    <td className="py-3">
                      <MaskedEmail email={r.referred_user?.email || ''} />
                      {r.signup_country && (
                        <div className="mt-0.5 text-xs text-[#6b6452]">
                          {r.signup_country}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-[#c9c2b0]">
                      {new Date(r.signed_up_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="py-3 uppercase text-[#c9c2b0]">{r.first_plan || 'free'}</td>
                    <td className="py-3">
                      <ReferralStatus status={r.status} />
                    </td>
                    <td className="py-3 text-right text-[#c9c2b0]">
                      {(Number(r.commission_rate_locked) * 100).toFixed(0)}%
                    </td>
                    <td className="py-3 text-right font-serif text-[#d4af37]">
                      ${Number(r.total_commission_earned_usd || 0).toFixed(2)}
                    </td>
                    <td className="py-3 text-right text-xs text-[#8a8370]">
                      {r.commission_window_ends_at
                        ? new Date(r.commission_window_ends_at).toLocaleDateString(undefined, {
                            month: 'short',
                            year: 'numeric',
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

      {/* Attribution note */}
      <div className="mt-10 rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-6 text-sm text-[#8a8370]">
        <strong className="text-[#c9c2b0]">Attribution is permanent.</strong> When someone signs up through your
        link, the attribution is locked at that moment and never changes, even if you&apos;re promoted to a higher
        tier. Your commission rate is also locked at the tier you held when they signed up — for the full 12-month
        commission window on that referral.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NavBreadcrumbs() {
  return (
    <div className="flex items-center gap-2 text-xs text-[#6b6452]">
      <Link href="/guild/dashboard" className="hover:text-[#c9c2b0]">
        Dashboard
      </Link>
      <span>→</span>
      <span className="text-[#c9c2b0]">My Referrals</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        highlight ? 'border-[#d4af37]/40 bg-[#d4af37]/5' : 'border-[#1e2436] bg-[#0f1424]'
      }`}
    >
      <div className="text-xs uppercase tracking-widest text-[#8a8370]">{label}</div>
      <div
        className={`mt-2 font-serif text-3xl tracking-tight ${
          highlight ? 'text-[#d4af37]' : 'text-[#e7e2d4]'
        }`}
      >
        {value}
      </div>
      {suffix && <div className="mt-1 text-xs text-[#6b6452]">{suffix}</div>}
    </div>
  );
}

function ReferralStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    signed_up:            { label: 'Signed up (free)', class: 'bg-gray-500/10 text-gray-400' },
    active_paid:          { label: 'Paying',           class: 'bg-yellow-500/10 text-yellow-400' },
    retention_qualified:  { label: 'Retained ✓',       class: 'bg-green-500/10 text-green-400' },
    cancelled:            { label: 'Cancelled',        class: 'bg-red-500/10 text-red-400' },
    refunded:             { label: 'Refunded',         class: 'bg-red-500/10 text-red-400' },
    flagged:              { label: 'Under review',     class: 'bg-orange-500/10 text-orange-400' },
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
    <span className="font-mono text-sm text-[#c9c2b0]">
      {masked}@{domain}
    </span>
  );
}

// ---------------------------------------------------------------------------
// (CopyButton is imported from @/components/guild/CopyButton — it's a client
// component in its own file because this page is a server component.)
