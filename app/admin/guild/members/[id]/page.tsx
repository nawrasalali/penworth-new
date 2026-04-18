import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { MemberActionsPanel } from './MemberActionsPanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.3 — /admin/guild/members/[id].
 *
 * Full member profile: tier, status, fee posture, referrals, Mentor
 * history, fraud flags, open tickets, tier promotion audit log. All
 * mutations go through the three migration-015 RPCs (guild_trigger_
 * probation, guild_lift_probation, guild_promote_tier) or the existing
 * guild_offboard_member RPC — no direct UPDATE from the UI.
 *
 * Admin layout already gates is_admin — this page trusts that.
 *
 * Data sources per pre-flight:
 *   fee posture     — guild_account_fees table directly (per-month) +
 *                      v_guild_account_fee_pipeline for aggregate (the
 *                      view is aggregate-only per Phase 1E pre-flight)
 *   Mentor history  — guild_weekly_checkins (the table code actively
 *                      uses; guild_pd_sessions exists but isn't
 *                      referenced by any current feature)
 *   fraud flags     — guild_fraud_flags WHERE guildmember_id = :id
 *   open tickets    — support_tickets WHERE user_id = member.user_id
 *                      AND status IN ('open','in_progress','awaiting_user')
 *   promotion audit — guild_tier_promotions WHERE guildmember_id = :id
 */

export default async function AdminGuildMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: memberId } = await params;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: member, error } = await admin
    .from('guild_members')
    .select('*')
    .eq('id', memberId)
    .maybeSingle();

  if (error) {
    console.error('[admin/guild/members/:id] fetch error:', error);
    notFound();
  }
  if (!member) notFound();

  // Fee posture — aggregate from view + per-month from table.
  const [
    { data: feePipeline },
    { data: feeMonths },
    { data: fraudFlags },
    { data: referrals },
    { data: openTickets },
    { data: weeklyCheckins },
    { data: tierPromotions },
  ] = await Promise.all([
    admin.from('v_guild_account_fee_pipeline').select('*').eq('guildmember_id', memberId).maybeSingle(),
    admin
      .from('guild_account_fees')
      .select('id, fee_month, tier_at_time, fee_amount_usd, amount_deducted_usd, amount_deferred_usd, amount_waived_usd, status, resolved_at')
      .eq('guildmember_id', memberId)
      .order('fee_month', { ascending: false })
      .limit(12),
    admin.from('guild_fraud_flags').select('*').eq('guildmember_id', memberId).order('created_at', { ascending: false }),
    admin.from('guild_referrals').select('id, status, referred_user_id, created_at').eq('guildmember_id', memberId).order('created_at', { ascending: false }).limit(10),
    admin
      .from('support_tickets')
      .select('id, ticket_number, subject, status, priority, created_at')
      .eq('user_id', member.user_id)
      .in('status', ['open', 'in_progress', 'awaiting_user'])
      .order('created_at', { ascending: false }),
    admin
      .from('guild_weekly_checkins')
      .select('id, week_of, mentor_journal_entry, created_at')
      .eq('guildmember_id', memberId)
      .order('week_of', { ascending: false })
      .limit(8),
    admin
      .from('guild_tier_promotions')
      .select('id, from_tier, to_tier, promotion_reason, evidence, promoted_at, promoted_by')
      .eq('guildmember_id', memberId)
      .order('promoted_at', { ascending: false })
      .limit(12),
  ]);

  // Admin identity of promoter — small batch lookup.
  const promoterIds = Array.from(
    new Set((tierPromotions || []).map((p) => p.promoted_by).filter(Boolean) as string[]),
  );
  const { data: promoters } =
    promoterIds.length > 0
      ? await admin.from('profiles').select('id, email, full_name').in('id', promoterIds)
      : { data: [] as Array<{ id: string; email: string; full_name: string | null }> };

  const promotersById = new Map((promoters || []).map((p) => [p.id, p]));
  const deferredBalance = Number(feePipeline?.deferred_balance_usd ?? 0);

  return (
    <div className="p-8">
      <Link
        href="/admin/guild"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Guild admin
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Guild member
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {member.display_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <TierBadge tier={member.tier} />
            <StatusBadge status={member.status} />
            <span className="text-muted-foreground">
              · referral code{' '}
              <code className="font-mono">{member.referral_code}</code>
            </span>
            <span className="text-muted-foreground">
              · joined {formatDistanceToNow(new Date(member.joined_at), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2/3: facts */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Profile">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary market" value={member.primary_market} />
              <Field label="Primary language" value={member.primary_language} />
              <Field label="Tier since" value={format(new Date(member.tier_since), 'PPP')} />
              <Field label="Payout method" value={member.payout_method || '—'} />
              <Field label="Tax residency" value={member.tax_residency || '—'} />
              <Field
                label="Vanity URL"
                value={member.vanity_url ? `/${member.vanity_url}` : '—'}
              />
            </dl>
          </Panel>

          {member.status === 'probation' && (
            <Panel title="Probation">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Started: </span>
                  {member.probation_started_at
                    ? formatDistanceToNow(new Date(member.probation_started_at), { addSuffix: true })
                    : '—'}
                </div>
                {member.probation_reason && (
                  <div>
                    <span className="text-muted-foreground">Reason: </span>
                    {member.probation_reason}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Deferred balance: </span>
                  <span className={deferredBalance > 0 ? 'font-medium text-yellow-400' : ''}>
                    ${deferredBalance.toFixed(2)}
                  </span>
                </div>
              </div>
            </Panel>
          )}

          <Panel title="Fee posture (last 12 months)">
            {!feeMonths || feeMonths.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No fee history yet — member joined recently or all months
                have been fully cleared.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 text-left font-normal">Month</th>
                      <th className="py-2 text-left font-normal">Tier</th>
                      <th className="py-2 text-right font-normal">Fee</th>
                      <th className="py-2 text-right font-normal">Deducted</th>
                      <th className="py-2 text-right font-normal">Deferred</th>
                      <th className="py-2 text-right font-normal">Waived</th>
                      <th className="py-2 text-right font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feeMonths.map((f) => (
                      <tr key={f.id} className="border-b border-border/40">
                        <td className="py-2">{f.fee_month}</td>
                        <td className="py-2 text-xs uppercase">{f.tier_at_time || '—'}</td>
                        <td className="py-2 text-right">${Number(f.fee_amount_usd).toFixed(2)}</td>
                        <td className="py-2 text-right">${Number(f.amount_deducted_usd).toFixed(2)}</td>
                        <td
                          className={`py-2 text-right ${
                            Number(f.amount_deferred_usd) > 0 ? 'text-yellow-400' : ''
                          }`}
                        >
                          ${Number(f.amount_deferred_usd).toFixed(2)}
                        </td>
                        <td className="py-2 text-right">${Number(f.amount_waived_usd).toFixed(2)}</td>
                        <td className="py-2 text-right text-xs uppercase">{f.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Tier promotion audit">
            {!tierPromotions || tierPromotions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No promotions recorded.</div>
            ) : (
              <ol className="space-y-3 text-sm">
                {tierPromotions.map((p) => {
                  const promoter = p.promoted_by ? promotersById.get(p.promoted_by) : null;
                  return (
                    <li key={p.id} className="rounded-md border bg-muted/30 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <div>
                          <span className="text-xs uppercase text-muted-foreground">
                            {p.from_tier || 'initial'} → {p.to_tier}
                          </span>{' '}
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">
                            {p.promotion_reason}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(p.promoted_at), 'PP')}
                        </span>
                      </div>
                      {p.evidence && typeof p.evidence === 'object' && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {(p.evidence as any).note ||
                            JSON.stringify(p.evidence)}
                        </div>
                      )}
                      {promoter && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          by {promoter.full_name || promoter.email}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <Panel title="Recent weekly check-ins">
            {!weeklyCheckins || weeklyCheckins.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No Mentor check-ins yet.
              </div>
            ) : (
              <ol className="space-y-3 text-sm">
                {weeklyCheckins.map((c) => (
                  <li key={c.id} className="rounded-md border bg-muted/30 p-3">
                    <div className="flex items-baseline justify-between">
                      <div className="text-xs uppercase text-muted-foreground">
                        Week of {c.week_of}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    {c.mentor_journal_entry && (
                      <div className="mt-2 whitespace-pre-wrap text-xs">
                        {String(c.mentor_journal_entry).slice(0, 280)}
                        {String(c.mentor_journal_entry).length > 280 && '…'}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* Right 1/3: actions, referrals, flags, tickets */}
        <aside className="space-y-6 lg:col-span-1">
          <MemberActionsPanel
            memberId={member.id}
            currentStatus={member.status}
            currentTier={member.tier}
          />

          <Panel title={`Referrals (${(referrals || []).length})`}>
            {!referrals || referrals.length === 0 ? (
              <div className="text-sm text-muted-foreground">No referrals yet.</div>
            ) : (
              <ol className="space-y-2 text-xs">
                {referrals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="uppercase text-muted-foreground">{r.status}</span>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title={`Fraud flags (${(fraudFlags || []).length})`}>
            {!fraudFlags || fraudFlags.length === 0 ? (
              <div className="text-sm text-muted-foreground">No flags.</div>
            ) : (
              <ol className="space-y-2 text-xs">
                {fraudFlags.map((f: any) => (
                  <li key={f.id} className="rounded border border-red-500/30 bg-red-500/5 p-2">
                    <div className="font-medium uppercase">{f.flag_type || f.type || 'flag'}</div>
                    {f.reason && <div className="mt-1 text-muted-foreground">{f.reason}</div>}
                    <div className="mt-1 text-muted-foreground">
                      {formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title={`Open tickets (${(openTickets || []).length})`}>
            {!openTickets || openTickets.length === 0 ? (
              <div className="text-sm text-muted-foreground">No open tickets.</div>
            ) : (
              <ol className="space-y-2">
                {openTickets.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/admin/tickets/${t.id}`}
                      className="block rounded-md border bg-muted/30 p-2 text-xs hover:bg-muted"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono">{t.ticket_number}</span>
                        <span className="uppercase text-muted-foreground">{t.status}</span>
                      </div>
                      <div className="mt-1 truncate">{t.subject}</div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || '—'}</dd>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-xs font-medium uppercase tracking-widest text-[#8a7a2a] border border-[#d4af37]/30">
      {tier}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-500/10 text-green-400 border-green-500/30',
    probation: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    terminated: 'bg-red-500/10 text-red-400 border-red-500/30',
    resigned: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-widest ${styles[status] || ''}`}
    >
      {status}
    </span>
  );
}
