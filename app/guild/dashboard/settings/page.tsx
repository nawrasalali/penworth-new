import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { maskPayoutDestinationSafe } from '@/lib/guild/payout-encryption';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings — Penworth Guild' };

export default async function GuildSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/guild/dashboard/settings');

  const admin = createAdminClient();
  const { data: member } = await admin
    .from('guild_members')
    .select(
      'id, display_name, tier, status, payout_method, payout_details_encrypted, tax_residency, primary_language',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) redirect('/guild/dashboard');

  const currentMask = member.payout_method
    ? maskPayoutDestinationSafe(
        member.payout_method,
        member.id,
        member.payout_details_encrypted,
      )
    : null;

  const hasPayoutMethod = !!(
    member.payout_method &&
    member.payout_method !== 'pending' &&
    member.payout_details_encrypted
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Your payout destination and tax residency. These are used when the
          Guild closes the month and queues your commission payment.
        </p>
      </div>

      {!hasPayoutMethod && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Payout method not set</p>
          <p className="mt-0.5">
            Commissions keep accruing, but nothing can be queued for payment
            until a destination is on file.
          </p>
        </div>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <header className="mb-5 border-b border-neutral-100 pb-4">
          <h2 className="text-base font-semibold text-neutral-900">
            Payout destination
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            We encrypt this on save. The stored value is never displayed — only
            the masked form below.
          </p>
        </header>

        {currentMask && (
          <div className="mb-5 rounded-md bg-neutral-50 px-3 py-2.5 text-sm">
            <span className="text-neutral-500">Current: </span>
            <span className="font-medium capitalize text-neutral-900">
              {member.payout_method}
            </span>
            <span className="mx-1.5 text-neutral-400">·</span>
            <span className="font-mono text-neutral-700">{currentMask}</span>
          </div>
        )}

        <SettingsForm
          initialMethod={
            member.payout_method === 'wise' || member.payout_method === 'usdt'
              ? member.payout_method
              : 'wise'
          }
          initialTaxResidency={member.tax_residency ?? ''}
        />
      </section>

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-neutral-900">
            Payout schedule
          </h2>
        </header>
        <ul className="space-y-2 text-sm text-neutral-700">
          <li>
            Commissions lock at month close once the 60-day retention gate has
            cleared.
          </li>
          <li>
            Payments are queued on the last business day of each month (Adelaide
            time) above the $50 threshold. Amounts below roll forward.
          </li>
          <li>
            Wise payouts are in your local currency at the mid-market rate; USDT
            payouts go to the wallet above (TRC20 or ERC20/BEP20, whichever you
            provided).
          </li>
        </ul>
      </section>
    </div>
  );
}
