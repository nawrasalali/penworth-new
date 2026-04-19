/**
 * Compliance-specific transactional emails.
 *
 * Separate from lib/email/index.ts and lib/email/templates.ts because
 * compliance emails are a regulatory surface — they're triggered by
 * admin fulfilment of DSR (data-subject rights) requests and need
 * careful wording to match the user-facing messages our /api/account
 * endpoints already promise.
 *
 * Pattern mirrors lib/email/guild.ts: lazy Resend init, fixed FROM,
 * BCC the founder for audit, clear subject lines, plain HTML.
 */

import { Resend } from 'resend';

let resendSingleton: Resend | null = null;
function getResend(): Resend {
  if (!resendSingleton) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    resendSingleton = new Resend(key);
  }
  return resendSingleton;
}

const FROM = 'Penworth Compliance <support@penworth.ai>';
const REPLY_TO = 'support@penworth.ai';
const FOUNDER_BCC = ['nawras@penworth.ai'];

// ----------------------------------------------------------------------------
// Export-ready email
// ----------------------------------------------------------------------------

export async function sendDataExportReadyEmail(options: {
  to: string;
  userName: string | null;
  signedUrl: string;
  expiresAt: string;
  fileSizeBytes: number;
  tablesExported: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { to, userName, signedUrl, expiresAt, fileSizeBytes, tablesExported } = options;

  const prettySize =
    fileSizeBytes < 1024 * 1024
      ? `${Math.round(fileSizeBytes / 1024)} KB`
      : `${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`;

  const expiryDate = new Date(expiresAt);
  const prettyExpiry = expiryDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Penworth data export is ready</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">Your data export is ready</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151;">
                Hi${userName ? ` ${userName}` : ''},
              </p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151;">
                We've prepared the data export you requested under your Right to
                Data Portability. The file contains every record we hold about
                you across ${tablesExported} data tables, plus your profile and
                account metadata.
              </p>
              <div style="margin:24px 0;padding:16px 20px;background-color:#f9fafb;border-left:4px solid #6366f1;border-radius:4px;">
                <p style="margin:0 0 8px;font-size:14px;color:#6b7280;"><strong>Format:</strong> JSON (human-readable)</p>
                <p style="margin:0 0 8px;font-size:14px;color:#6b7280;"><strong>Size:</strong> ${prettySize}</p>
                <p style="margin:0;font-size:14px;color:#6b7280;"><strong>Link expires:</strong> ${prettyExpiry}</p>
              </div>
              <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="background-color:#6366f1;border-radius:8px;">
                    <a href="${signedUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;">Download your data</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
                This link is private and expires in 7 days. Do not share it.
                If you need a new link after it expires, submit another request
                from your account settings.
              </p>
              <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#6b7280;">
                The export does not include encrypted credentials (publishing
                platform passwords and API keys have been redacted). If you
                need those, we can arrange a separate secure transfer.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Penworth · ACN 675 668 710 · Adelaide, South Australia<br>
                This email was sent because you requested a data export. Questions? Reply here.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: [to],
      subject: 'Your Penworth data export is ready',
      html,
      replyTo: REPLY_TO,
      bcc: FOUNDER_BCC,
    });
    if (error) {
      console.error('[compliance email] send error:', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[compliance email] crashed:', msg);
    return { ok: false, error: msg };
  }
}
