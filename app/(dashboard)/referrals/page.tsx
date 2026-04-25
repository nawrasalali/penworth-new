import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import {
  Award, BookOpen, BarChart3, Settings, Bot, FileCheck,
} from 'lucide-react';
import { ReferralDashboard } from '@/components/dashboard/ReferralDashboard';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /referrals — single page for everything author-referral and Guild (CEO-085).
 *
 * Three sections rendered top-to-bottom:
 *
 *   1. Refer an Author — existing <ReferralDashboard> client component, kept
 *      verbatim. Code, shareable link, copy/share actions, lifetime stats.
 *
 *   2. Guild upgrade pitch — static marketing block. Shown to every author so
 *      the Guild stays visible after the sidebar's amber Guild block was
 *      removed. CTA links to /guild (the existing application/voice-interview
 *      flow at app/guild/**).
 *
 *   3. Guild dashboard quick-links — only rendered if the current user has an
 *      active or probation guild_members row. For the Founder (and future
 *      Guild members) this preserves one-click access to Application,
 *      Academy, Financials, Settings, and Agents now that the dedicated
 *      sidebar entry is gone.
 */
export default async function ReferralsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Please log in to view your referrals.</p>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('id', user.id)
    .single();
  const rawLang = (profile?.preferred_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  const { data: guildMember } = await supabase
    .from('guild_members')
    .select('id, status, tier')
    .eq('user_id', user.id)
    .in('status', ['active', 'probation'])
    .maybeSingle();

  const isActiveGuildMember = !!guildMember;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
      {/* ====== Section 1: Refer an Author ====== */}
      <section>
        <header className="mb-4">
          <h1 className="text-3xl font-bold tracking-tight">
            {t('referrals.referAuthorHeader', locale)}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('referrals.referAuthorBody', locale)}
          </p>
        </header>
        <ReferralDashboard />
      </section>

      {/* Section 2 (Guild upgrade pitch) deliberately omitted — the
          ReferralDashboard component already renders a smart Guild banner
          (visible above 3 successful referrals) plus a smaller Guild
          awareness card below threshold. Adding another Guild block here
          would be redundant and noisier than the brief's intent. */}

      {/* ====== Section 3: Guild dashboard quick-links (active members only) ====== */}
      {isActiveGuildMember && (
        <section>
          <header className="mb-4 flex items-center gap-2">
            <Award className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            <h2 className="text-xl font-bold tracking-tight">
              {t('referrals.guildDashHeader', locale)}
            </h2>
            {guildMember.tier && (
              <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-500 font-semibold">
                {guildMember.tier}
              </span>
            )}
          </header>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <QuickLink href="/guild/status" icon={FileCheck} label={t('referrals.guildDashApplication', locale)} />
            <QuickLink href="/guild/dashboard/academy" icon={BookOpen} label={t('referrals.guildDashAcademy', locale)} />
            <QuickLink href="/guild/dashboard/financials" icon={BarChart3} label={t('referrals.guildDashFinancials', locale)} />
            <QuickLink href="/guild/dashboard/settings" icon={Settings} label={t('referrals.guildDashSettings', locale)} />
            <QuickLink href="/guild/dashboard/agents" icon={Bot} label={t('referrals.guildDashAgents', locale)} />
          </div>
        </section>
      )}
    </div>
  );
}

function QuickLink({
  href, icon: Icon, label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-card hover:bg-muted transition-colors px-4 py-3 flex items-center gap-2 text-sm font-medium"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
