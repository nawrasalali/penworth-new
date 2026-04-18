import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.2 — /admin/tickets queue.
 *
 * The admin layout (app/admin/layout.tsx) already enforces is_admin, so this
 * page can trust it runs only for admins.
 *
 * Data source: support_tickets. Schema shape per Phase 2 pre-flight A6/A7/A8:
 *   status enum: open | in_progress | awaiting_user | resolved |
 *                closed_no_response | merged
 *   (merged is set only by the Merge action — NOT in the dropdown)
 *   category enum: billing | payout | commission | account | technical |
 *                  content_issue | fraud_dispute | legal | other
 *   surface enum: author | guild | store | admin
 *   priority enum: low | normal | high | urgent (DEFAULT 'normal')
 *
 * We don't touch support_tickets via direct UPDATE anywhere in the UI —
 * the reply composer and status/assign changes all go through the
 * /api/admin/tickets/[id]/* POST endpoints so every mutation has a
 * single point of audit.
 *
 * Query shape: fetches the open-lane view (status IN open/in_progress/
 * awaiting_user) sorted by priority DESC + created_at ASC. Closed and
 * resolved tickets are filterable but not shown by default — most admin
 * work is on open tickets.
 */

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_user: 'Awaiting User',
  resolved: 'Resolved',
  closed_no_response: 'Closed',
  merged: 'Merged',
};

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-400 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  low: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

// Priority ORDER BY doesn't sort the enum naturally (alphabetical).
// Use a CASE expression via client-side post-sort since we can't express
// CASE inside Supabase's orderBy. The default-fetch is small enough
// (<200 rows max realistically) that client-side sort is fine.
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

interface SearchParams {
  status?: string;
  category?: string;
  surface?: string;
  assigned_to?: string;
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Defaults: show open lanes only. Filters stack on top.
  let query = supabase
    .from('support_tickets')
    .select(
      'id, ticket_number, subject, category, surface, priority, status, assigned_to, user_id, created_at, updated_at',
    );

  if (params.status) {
    query = query.eq('status', params.status);
  } else {
    // Default view: non-terminal lanes
    query = query.in('status', ['open', 'in_progress', 'awaiting_user']);
  }
  if (params.category) query = query.eq('category', params.category);
  if (params.surface) query = query.eq('surface', params.surface);
  if (params.assigned_to) {
    if (params.assigned_to === 'unassigned') {
      query = query.is('assigned_to', null);
    } else {
      query = query.eq('assigned_to', params.assigned_to);
    }
  }

  const { data: ticketsRaw, error } = await query
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[admin/tickets] fetch error:', error);
  }

  const tickets = (ticketsRaw || []).slice().sort((a, b) => {
    const byPriority = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (byPriority !== 0) return byPriority;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Assignee dropdown source — admins only. Validation also happens
  // server-side in the mutation routes.
  const { data: adminProfiles } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('is_admin', true)
    .order('full_name', { ascending: true, nullsFirst: false });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Support Tickets</h1>
        <p className="text-muted-foreground mt-1">
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'} in view
        </p>
      </div>

      <FiltersBar
        adminProfiles={adminProfiles || []}
        current={params}
      />

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">Subject</th>
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-4 py-3 text-left font-medium">Surface</th>
              <th className="px-4 py-3 text-left font-medium">Priority</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Assignee</th>
              <th className="px-4 py-3 text-left font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  No tickets match these filters.
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const assignee = (adminProfiles || []).find((a) => a.id === t.assigned_to);
                return (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tickets/${t.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {t.ticket_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 max-w-md truncate">
                      <Link href={`/admin/tickets/${t.id}`} className="hover:underline">
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase text-muted-foreground">
                      {t.category}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase text-muted-foreground">
                      {t.surface}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded border px-2 py-0.5 text-xs uppercase ${PRIORITY_STYLES[t.priority] || ''}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{STATUS_LABELS[t.status] ?? t.status}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {assignee ? assignee.full_name || assignee.email : <span className="italic">unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FiltersBar({
  adminProfiles,
  current,
}: {
  adminProfiles: Array<{ id: string; email: string; full_name: string | null }>;
  current: SearchParams;
}) {
  // Pure server-rendered filter bar — each select submits via GET form,
  // no client JS needed. Back/forward works naturally.
  return (
    <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
      <Select
        name="status"
        label="Status"
        value={current.status || ''}
        options={[
          { value: '', label: 'Open lanes' },
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In Progress' },
          { value: 'awaiting_user', label: 'Awaiting User' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed_no_response', label: 'Closed' },
        ]}
      />
      <Select
        name="category"
        label="Category"
        value={current.category || ''}
        options={[
          { value: '', label: 'All' },
          { value: 'billing', label: 'Billing' },
          { value: 'payout', label: 'Payout' },
          { value: 'commission', label: 'Commission' },
          { value: 'account', label: 'Account' },
          { value: 'technical', label: 'Technical' },
          { value: 'content_issue', label: 'Content Issue' },
          { value: 'fraud_dispute', label: 'Fraud Dispute' },
          { value: 'legal', label: 'Legal' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <Select
        name="surface"
        label="Surface"
        value={current.surface || ''}
        options={[
          { value: '', label: 'All' },
          { value: 'author', label: 'Author' },
          { value: 'guild', label: 'Guild' },
          { value: 'store', label: 'Store' },
          { value: 'admin', label: 'Admin' },
        ]}
      />
      <Select
        name="assigned_to"
        label="Assignee"
        value={current.assigned_to || ''}
        options={[
          { value: '', label: 'All' },
          { value: 'unassigned', label: 'Unassigned' },
          ...adminProfiles.map((a) => ({
            value: a.id,
            label: a.full_name || a.email,
          })),
        ]}
      />
      <button
        type="submit"
        className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
      >
        Apply
      </button>
      <Link
        href="/admin/tickets"
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Clear
      </Link>
    </form>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="min-w-[150px] rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
