import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { TicketControls } from './TicketControls';
import { ReplyComposer } from './ReplyComposer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.2 — /admin/tickets/[id] detail view.
 *
 * Layout:
 *   Left (2/3): ticket header + thread (initial_description, Nora
 *     diagnosis, Nora attempted fixes timeline, all replies)
 *   Right (1/3): member snapshot from v_nora_member_context (the contract
 *     per the pre-flight — we do NOT reconstruct this client-side)
 *
 * All mutations go through /api/admin/tickets/[id]/* server routes.
 * The right-side widgets are pure server-rendered; the reply composer
 * and status/assign selects are thin client islands that POST to the
 * mutation routes.
 */

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_user: 'Awaiting User',
  resolved: 'Resolved',
  closed_no_response: 'Closed',
  merged: 'Merged',
};

export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[admin/tickets/:id] fetch error:', error);
    notFound();
  }
  if (!ticket) {
    notFound();
  }

  // Thread replies — ordered chronologically. Internal notes (is_internal_note=
  // true) are included and styled distinctly. Admin thread shows everything.
  const { data: replies } = await supabase
    .from('support_ticket_replies')
    .select('id, author_id, author_role, body, is_internal_note, created_at')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true });

  // Right-side snapshot — v_nora_member_context is the contract.
  // If the user isn't in the view (e.g., non-member filing from store
  // surface), we get null and render a minimal panel.
  const { data: memberContext } = await supabase
    .from('v_nora_member_context')
    .select('*')
    .eq('user_id', ticket.user_id)
    .maybeSingle();

  // Admin assignee dropdown source — same as queue page.
  const { data: adminProfiles } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('is_admin', true)
    .order('full_name', { ascending: true, nullsFirst: false });

  const assignee = (adminProfiles || []).find((a) => a.id === ticket.assigned_to);

  // Nora attempted fixes jsonb shape per brief: array of {tool, result, at}
  // entries. Render defensively in case the shape is slightly different.
  const attemptedFixes = Array.isArray(ticket.nora_attempted_fixes)
    ? ticket.nora_attempted_fixes
    : [];

  return (
    <div className="p-8">
      <Link
        href="/admin/tickets"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to tickets
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-muted-foreground">
            {ticket.ticket_number}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {ticket.subject}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase">{ticket.category}</span>
            <span>·</span>
            <span className="uppercase">{ticket.surface}</span>
            <span>·</span>
            <span className="uppercase">{ticket.priority}</span>
            <span>·</span>
            <span>Opened {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: thread + controls + composer */}
        <div className="space-y-6 lg:col-span-2">
          <TicketControls
            ticketId={ticket.id}
            currentStatus={ticket.status}
            currentAssignedTo={ticket.assigned_to}
            adminProfiles={adminProfiles || []}
          />

          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Initial report
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {format(new Date(ticket.created_at), 'PPpp')}
              </div>
            </div>
            <div className="whitespace-pre-wrap px-4 py-4 text-sm">
              {ticket.initial_description}
            </div>
          </section>

          {ticket.nora_diagnosis && (
            <section className="rounded-lg border bg-[#d4af37]/5">
              <div className="border-b border-[#d4af37]/20 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
                  Nora diagnosis
                </div>
              </div>
              <div className="whitespace-pre-wrap px-4 py-4 text-sm">
                {ticket.nora_diagnosis}
              </div>
            </section>
          )}

          {attemptedFixes.length > 0 && (
            <section className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Nora attempted fixes
                </div>
              </div>
              <ol className="divide-y">
                {attemptedFixes.map((fix: any, idx: number) => (
                  <li key={idx} className="px-4 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {fix.tool || 'tool'}
                      </span>
                      {fix.at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(fix.at), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    {fix.result && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {typeof fix.result === 'string' ? fix.result : JSON.stringify(fix.result)}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Replies ({(replies || []).length})
            </h2>
            {(replies || []).length === 0 ? (
              <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No replies yet.
              </div>
            ) : (
              (replies || []).map((r) => (
                <div
                  key={r.id}
                  className={`rounded-lg border p-4 ${
                    r.is_internal_note
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : r.author_role === 'admin'
                        ? 'bg-muted/30'
                        : 'bg-card'
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium uppercase">
                      {r.author_role}
                    </span>
                    {r.is_internal_note && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700">
                        Internal note
                      </span>
                    )}
                    <span>·</span>
                    <span>{format(new Date(r.created_at), 'PPpp')}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm">{r.body}</div>
                </div>
              ))
            )}
          </section>

          <ReplyComposer ticketId={ticket.id} />
        </div>

        {/* Right: member snapshot */}
        <aside className="lg:col-span-1">
          <section className="sticky top-6 rounded-lg border bg-card p-4">
            <div className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
              Member snapshot
            </div>
            {memberContext ? (
              <dl className="space-y-3 text-sm">
                {Object.entries(memberContext).map(([key, val]) => {
                  if (val === null || val === undefined || val === '') return null;
                  return (
                    <div key={key}>
                      <dt className="text-xs uppercase text-muted-foreground">
                        {key.replace(/_/g, ' ')}
                      </dt>
                      <dd className="mt-0.5 break-words">
                        {typeof val === 'object' ? (
                          <code className="text-xs">{JSON.stringify(val)}</code>
                        ) : (
                          String(val)
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <div className="text-sm text-muted-foreground">
                User not in Nora member context view. This is common for
                non-Guildmembers filing from the author or store surface.
              </div>
            )}
            <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
              Status:{' '}
              <span className="font-medium">
                {STATUS_LABELS[ticket.status] ?? ticket.status}
              </span>
              <br />
              Assigned to:{' '}
              <span className="font-medium">
                {assignee ? assignee.full_name || assignee.email : 'unassigned'}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
