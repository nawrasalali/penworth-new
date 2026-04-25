import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { GrantForm } from './GrantForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center/grants
 *
 * Super_admin operator page to grant credits to any user. Three sections:
 *
 *   1. All users — every signed-up user with their current balance and
 *      plan, with a per-row link that pre-fills the form below. Lets
 *      the Founder see who exists and pick a recipient without having
 *      to type the email manually.
 *
 *   2. Issue a grant — the form, with optional ?email= prefill.
 *
 *   3. Recent admin grants — last 50 admin_adjustment ledger rows so
 *      every grant is auditable.
 *
 * Calls admin_grant_credits RPC. Atomic balance + ledger write. The new
 * balance is read by the writer's existing credits-balance UI on next
 * load (or the next request to /api/credits/balance), so credits become
 * usable for chapter generation, image generation, etc. immediately.
 */

type LedgerRow = {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  profiles: { email: string | null; full_name: string | null } | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  credits_balance: number | null;
  plan: string | null;
  is_admin: boolean | null;
  created_at: string;
};

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function GrantsPage({ searchParams }: PageProps) {
  await requireAdminRole('super_admin');

  const { email: prefilledEmail } = await searchParams;

  const admin = createServiceClient();

  const [{ data: users }, { data: recent }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, full_name, credits_balance, plan, is_admin, created_at')
      .order('created_at', { ascending: false })
      .returns<ProfileRow[]>(),
    admin
      .from('credits_ledger')
      .select(
        'id, user_id, amount, balance_after, description, created_at, profiles:user_id(email, full_name)',
      )
      .eq('transaction_type', 'admin_adjustment')
      .order('created_at', { ascending: false })
      .limit(50)
      .returns<LedgerRow[]>(),
  ]);

  const userRows = users ?? [];
  const ledgerRows = recent ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2">
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          ← Founder View
        </Link>
      </div>

      <div className="mb-8 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Send credits</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a user below to pre-fill the form, or enter any email manually.
          Credits land instantly: the recipient&apos;s balance and ledger
          update in one transaction, and they can spend them on chapter
          generation, image generation, and other writer tools right away.
        </p>
      </div>

      {/* Users list */}
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-1">All users ({userRows.length})</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Newest first. Click a row to send credits to that user.
        </p>
        {userRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users signed up yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-y">
                <tr className="text-left">
                  <th className="px-6 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">User</th>
                  <th className="px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Plan</th>
                  <th className="px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground text-right">Balance</th>
                  <th className="px-3 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Joined</th>
                  <th className="px-6 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground text-right"></th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((u) => (
                  <tr key={u.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-6 py-3">
                      <div className="font-medium">{u.full_name || u.email || '—'}</div>
                      {u.email && u.full_name && (
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      )}
                      {u.is_admin && (
                        <span className="inline-block mt-1 text-[10px] uppercase tracking-wider font-bold text-primary">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {u.plan ?? 'free'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {(u.credits_balance ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {u.created_at ? formatDistanceToNow(new Date(u.created_at), { addSuffix: true }) : '—'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {u.email ? (
                        <Link
                          href={`/admin/command-center/grants?email=${encodeURIComponent(u.email)}#grant`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Send credits →
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">no email</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Grant form */}
      <section
        id="grant"
        className="mt-8 rounded-2xl border bg-card p-6 shadow-sm scroll-mt-8"
      >
        <h2 className="text-lg font-semibold mb-1">
          Issue a grant
          {prefilledEmail && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              → {prefilledEmail}
            </span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Atomic: profile balance + ledger update in one transaction. Every
          grant is attributed to you in the ledger description.
        </p>
        <GrantForm defaultEmail={prefilledEmail} />
      </section>

      {/* Recent grants */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-4">
          Recent admin grants ({ledgerRows.length})
        </h2>
        {ledgerRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admin grants yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">New balance</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {r.profiles?.full_name || r.profiles?.email || r.user_id.slice(0, 8)}
                      </div>
                      {r.profiles?.email && r.profiles?.full_name && (
                        <div className="text-xs text-muted-foreground">
                          {r.profiles.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      +{r.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {r.balance_after.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.description ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
