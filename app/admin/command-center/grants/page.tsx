import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { formatDistanceToNow } from 'date-fns';
import { GrantForm } from './GrantForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center/grants
 *
 * Super_admin operator page to grant credits to any user by email.
 * Calls admin_grant_credits RPC (CEO-050). Atomic balance + ledger write.
 *
 * Lists the 50 most recent admin_adjustment ledger entries so the founder
 * can see what has been granted and when.
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

export default async function GrantsPage() {
  await requireAdminRole('super_admin');

  const admin = createServiceClient();
  const { data: recent } = await admin
    .from('credits_ledger')
    .select(
      'id, user_id, amount, balance_after, description, created_at, profiles:user_id(email, full_name)',
    )
    .eq('transaction_type', 'admin_adjustment')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<LedgerRow[]>();

  const rows = recent ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Credit grants</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Grant credits to any user by email. Atomic: profile balance and
          ledger update in one transaction. Every grant is attributed to
          you in the ledger description.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Issue a grant</h2>
        <GrantForm />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-4">
          Recent admin grants ({rows.length})
        </h2>
        {rows.length === 0 ? (
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
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {r.profiles?.full_name ?? '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.profiles?.email ?? r.user_id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.amount > 0 ? '+' : ''}
                      {r.amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                      {r.balance_after.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-md truncate">
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
