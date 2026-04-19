import { NoraWidget } from '@/components/nora/NoraWidget';

/**
 * Phase 2.5 Item 3 Commit 9 — Guild member area layout.
 *
 * The Guild route tree has a split personality:
 *   app/guild/layout.tsx          — marketing shell for guild.penworth.ai
 *                                    (anonymous visitors, dark theme,
 *                                    apply page, FAQ, etc.)
 *   app/guild/dashboard/**        — authenticated member area
 *                                    (this layout wraps it)
 *
 * Marketing pages don't get Nora — anonymous visitors have no user_id
 * to contextualize, and the widget would just fail to start. Member
 * pages get Nora with surface='guild' so Nora's context loads the
 * Guild state (tier, fee posture, referrals, payouts, fraud flags).
 *
 * Each dashboard page performs its own auth + guildmember check
 * server-side — the layout adds no additional gating. The widget
 * does its own mount guard via /api/nora/conversation/start, so a
 * user who somehow lands here without Guild membership will see the
 * widget briefly then have it self-hide on the start-response.
 */
export default function GuildDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <NoraWidget surface="guild" />
    </>
  );
}
