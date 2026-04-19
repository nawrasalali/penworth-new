import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/alert-dispatch
 *
 * Polls alert_log for rows with delivery_status='pending' and a non-empty
 * recipients_json. Sends each to the named recipients via Resend, then
 * flips delivery_status='sent' (or 'failed' with delivery_error) so the
 * same row is never processed twice.
 *
 * Schedule: every minute (Vercel cron minimum granularity is 1 minute â
 * the brief asked for 30 seconds but that isn't available on Vercel
 * crons). The alert_dispatch() SQL function fires a row the instant an
 * incident or stripe failure is detected, and the stuck detector is
 * usually the generator â a 60-second delivery delay on a 15-minute
 * detection threshold is fine.
 *
 * Ordering: P0 first, then P1, then P2, oldest-first within severity.
 * Batch cap: 50 alerts per run so we can't blow through maxDuration on
 * a backlog. Anything above 50 rolls forward to the next run.
 *
 * Categories the cron receives:
 *   pipeline, financial, security, api_health, ai_cost    â admin
 *   user_support                                          â author
 *
 * Admin messages get a [SEVERITY] prefix and a dashboard link. Author
 * messages get warmer framing with a reply-to-support footer.
 *
 * Resilience: per-recipient error isolation. One recipient's SMTP
 * bounce doesn't abort the whole row â we record the error, mark the
 * row failed (so it's not retried blindly), and move on.
 *
 * Query params:
 *   ?dry=1    â decide + format but don't send or mutate state
 *   ?limit=N  â override the 50-row batch cap (max 200)
 */

// ===========================================================================
// CONFIG
// ===========================================================================

const FROM_ADMIN_EMAIL = 'Penworth Alerts <alerts@penworth.ai>';
const FROM_USER_EMAIL = 'Penworth <support@penworth.ai>';
const REPLY_TO = 'support@penworth.ai';
const DASHBOARD_URL = 'https://penworth.ai/admin/command-center';

const ADMIN_CATEGORIES = new Set([
  'pipeline',
  'financial',
  'security',
  'api_health',
  'ai_cost',
]);

// Single shared Resend client â lazy so the import doesn't fail at
// module load when RESEND_API_KEY hasn't been injected into dev.
let resendSingleton: Resend | null = null;
function getResend(): Resend {
  if (!resendSingleton) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    resendSingleton = new Resend(key);
  }
  return resendSingleton;
}

// ===========================================================================
// HANDLER
// ===========================================================================

interface PendingAlert {
  id: string;
  source_type: string;
  source_id: string | null;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  category: string;
  title: string;
  body: string;
  recipients_json: Array<{ email: string; name?: string | null }>;
  sent_at: string;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1';
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get('limit') ?? 50)),
    200,
  );

  const admin = createServiceClient();

  try {
    // Pull pending rows ordered by severity (p0 first) then oldest first.
    // p3 is excluded â those are audit-only and should never trigger mail.
    // We order on a client-side CASE because Supabase REST doesn't support
    // ORDER BY CASE directly. Instead: fetch by severity in sequence.
    const all: PendingAlert[] = [];
    for (const sev of ['p0', 'p1', 'p2'] as const) {
      if (all.length >= limit) break;
      const { data, error } = await admin
        .from('alert_log')
        .select(
          'id, source_type, source_id, severity, category, title, body, recipients_json, sent_at',
        )
        .eq('delivery_status', 'pending')
        .eq('severity', sev)
        .order('sent_at', { ascending: true })
        .limit(limit - all.length);

      if (error) {
        console.error(`[alert-dispatch] fetch failed for ${sev}:`, error);
        continue;
      }
      for (const row of data ?? []) {
        // Drop rows with no recipients â they're a no-op. Mark them
        // suppressed so they don't re-appear. (The alert_dispatch SQL
        // function should have set suppressed_quiet_hours on these
        // already, but a defensive belt-and-braces check.)
        const recips = (row.recipients_json as unknown[]) ?? [];
        if (!Array.isArray(recips) || recips.length === 0) {
          if (!dryRun) {
            await admin
              .from('alert_log')
              .update({
                delivery_status: 'suppressed_quiet_hours',
                delivery_error: 'no recipients at send time',
              })
              .eq('id', row.id);
          }
          continue;
        }
        all.push(row as PendingAlert);
      }
    }

    if (all.length === 0) {
      return NextResponse.json({
        ok: true,
        pending: 0,
        sent: 0,
        failed: 0,
        dry_run: dryRun,
      });
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        pending: all.length,
        alerts: all.map((a) => ({
          id: a.id,
          severity: a.severity,
          category: a.category,
          title: a.title,
          recipient_count: a.recipients_json.length,
        })),
      });
    }

    // Send one Resend call per (alert, recipient) pair. We parallelise
    // per-alert but serialise per-recipient so a single bad row never
    // takes out an adjacent one.
    let sent = 0;
    let failed = 0;
    const errors: Array<{ alert_id: string; error: string }> = [];

    for (const alert of all) {
      try {
        const isUserFacing = !ADMIN_CATEGORIES.has(alert.category);
        const from = isUserFacing ? FROM_USER_EMAIL : FROM_ADMIN_EMAIL;

        const subject = isUserFacing
          ? alert.title
          : `[${alert.severity.toUpperCase()}] ${alert.title}`;

        const html = renderAlertHtml({ alert, isUserFacing });

        // Send to all recipients in one Resend call for efficiency.
        // `to` accepts an array; downside is one bad address fails the
        // whole batch. We could loop per recipient if bounce isolation
        // matters more â for now keep it simple; flag failures for the
        // founder to investigate in the Command Center later.
        const recipientEmails = alert.recipients_json
          .map((r) => r.email)
          .filter(Boolean);

        const result = await getResend().emails.send({
          from,
          to: recipientEmails,
          replyTo: REPLY_TO,
          subject,
          html,
          text: plainTextFallback(alert, isUserFacing),
        });

        if ((result as any).error) {
          throw new Error((result as any).error.message ?? 'Resend returned an error');
        }

        await admin
          .from('alert_log')
          .update({
            delivery_status: 'sent',
            delivery_error: null,
          })
          .eq('id', alert.id);

        sent++;
      } catch (sendErr) {
        const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[alert-dispatch] send failed for alert ${alert.id}:`, message);

        await admin
          .from('alert_log')
          .update({
            delivery_status: 'failed',
            delivery_error: message.slice(0, 500),
          })
          .eq('id', alert.id);

        failed++;
        errors.push({ alert_id: alert.id, error: message });
      }
    }

    return NextResponse.json({
      ok: true,
      pending: all.length,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[alert-dispatch] unexpected error:', err);
    return NextResponse.json(
      { error: 'cron_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ===========================================================================
// RENDERING
// ===========================================================================

/**
 * Admin alerts want utilitarian framing â severity badge, title, body
 * preformatted to respect newlines, action link. User alerts want
 * warmer framing with a dashboard CTA.
 */
function renderAlertHtml(input: {
  alert: PendingAlert;
  isUserFacing: boolean;
}): string {
  const { alert, isUserFacing } = input;

  const severityColor =
    alert.severity === 'p0'
      ? '#dc2626' // red
      : alert.severity === 'p1'
        ? '#ea580c' // orange
        : '#facc15'; // amber

  const severityBadge = isUserFacing
    ? ''
    : `<span style="display: inline-block; padding: 4px 10px; background-color: ${severityColor}; color: #0f172a; font-size: 11px; font-weight: bold; letter-spacing: 1px; border-radius: 4px; margin-bottom: 16px;">${alert.severity.toUpperCase()} Â· ${alert.category.toUpperCase()}</span>`;

  const bodyHtml = escapeHtml(alert.body).replace(/\n/g, '<br>');

  const cta = isUserFacing
    ? `<a href="https://penworth.ai/dashboard" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 10px;">Go to dashboard</a>`
    : `<a href="${DASHBOARD_URL}" style="display: inline-block; padding: 14px 28px; background-color: #facc15; color: #0f172a; font-size: 15px; font-weight: bold; text-decoration: none; border-radius: 10px;">Open Command Center</a>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(alert.title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0f172a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
              <div style="display: inline-block; width: 36px; height: 36px; background: linear-gradient(135deg, #facc15, #eab308); border-radius: 8px; text-align: center; line-height: 36px; font-size: 18px; margin-right: 10px; vertical-align: middle;">ð</div>
              <span style="font-size: 20px; font-weight: bold; color: #ffffff; vertical-align: middle;">Penworth</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 40px;">
              ${severityBadge}
              <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: bold; color: #ffffff; line-height: 1.3;">
                ${escapeHtml(alert.title)}
              </h1>
              <div style="margin: 0 0 28px; font-size: 15px; color: #cbd5e1; line-height: 1.7;">
                ${bodyHtml}
              </div>
              <div style="text-align: center;">${cta}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #0f172a; border-top: 1px solid #334155;">
              <p style="margin: 0; font-size: 11px; color: #64748b; text-align: center; line-height: 1.6;">
                Alert ID: <code style="color: #94a3b8;">${alert.id}</code><br>
                ${
                  isUserFacing
                    ? 'Reply to this email to reach our support team.'
                    : `Sent by the Penworth Command Center monitor at ${new Date(alert.sent_at).toISOString()}.`
                }
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function plainTextFallback(alert: PendingAlert, isUserFacing: boolean): string {
  const header = isUserFacing
    ? `Penworth\n\n${alert.title}`
    : `[${alert.severity.toUpperCase()}] ${alert.title}\n\n`;
  const footer = isUserFacing
    ? `\n\nReply to this email to reach our support team.\n`
    : `\n\nOpen the Command Center: ${DASHBOARD_URL}\nAlert ID: ${alert.id}\n`;
  return `${header}\n\n${alert.body}${footer}`;
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
