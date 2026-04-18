import { Resend } from 'resend';

// Lazy-init — see lib/email/guild.ts for rationale
let resendSingleton: Resend | null = null;
function getResend(): Resend {
  if (!resendSingleton) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY is not set');
    }
    resendSingleton = new Resend(key);
  }
  return resendSingleton;
}

// support@ rather than noreply@ so replies route to the real inbox. Users
// who reply to a 'noreply' address get nothing back; we'd rather catch the
// replies and answer them.
const FROM_EMAIL = 'Penworth <support@penworth.ai>';
const SUPPORT_EMAIL = 'support@penworth.ai';

// BCC the founder on every org email. Strictly BCC — never client-visible.
const FOUNDER_BCC = ['nawras@penworth.ai'];

// Base email wrapper with Penworth branding
function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Penworth</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background-color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0f172a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #1e293b; border-radius: 16px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, #facc15, #eab308); border-radius: 10px; text-align: center; line-height: 40px; font-size: 20px; margin-right: 12px; vertical-align: middle;">📖</div>
                    <span style="font-size: 24px; font-weight: bold; color: #ffffff; vertical-align: middle;">Penworth</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #0f172a; border-top: 1px solid #334155;">
              <p style="margin: 0; font-size: 12px; color: #64748b; text-align: center;">
                © 2026 A.C.N. 675 668 710 PTY LTD. All rights reserved.<br>
                <a href="https://penworth.ai/help" style="color: #facc15; text-decoration: none;">Help</a> · 
                <a href="https://penworth.ai/privacy" style="color: #facc15; text-decoration: none;">Privacy</a> · 
                <a href="https://penworth.ai/terms" style="color: #facc15; text-decoration: none;">Terms</a>
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

// ==================== EMAIL TEMPLATES ====================

export interface OrgInviteEmailData {
  inviteeName: string;
  inviterName: string;
  orgName: string;
  role: 'admin' | 'editor' | 'viewer';
  inviteLink: string;
  expiresIn?: string;
}

export async function sendOrgInviteEmail(to: string, data: OrgInviteEmailData) {
  const roleDescriptions: Record<string, string> = {
    admin: 'Full access to manage the organization, members, and all projects',
    editor: 'Create and edit books, use credits, and collaborate on projects',
    viewer: 'View projects and provide feedback',
  };

  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      You're invited to join ${data.orgName}!
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi${data.inviteeName ? ` ${data.inviteeName}` : ''},
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      <strong style="color: #ffffff;">${data.inviterName}</strong> has invited you to join 
      <strong style="color: #ffffff;">${data.orgName}</strong> on Penworth as a 
      <strong style="color: #facc15;">${data.role}</strong>.
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 8px; font-size: 14px; color: #64748b;">Your role permissions:</p>
      <p style="margin: 0; font-size: 14px; color: #94a3b8;">${roleDescriptions[data.role]}</p>
    </div>
    
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <a href="${data.inviteLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 12px;">
            Accept Invitation
          </a>
        </td>
      </tr>
    </table>
    
    <p style="margin: 24px 0 0; font-size: 14px; color: #64748b; text-align: center;">
      ${data.expiresIn ? `This invitation expires in ${data.expiresIn}.` : 'This invitation expires in 7 days.'}<br>
      If you didn't expect this invitation, you can safely ignore this email.
    </p>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `${data.inviterName} invited you to join ${data.orgName} on Penworth`,
    html: emailWrapper(content),
  });
}

export interface WelcomeToOrgEmailData {
  memberName: string;
  orgName: string;
  role: string;
  dashboardLink: string;
}

export async function sendWelcomeToOrgEmail(to: string, data: WelcomeToOrgEmailData) {
  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      Welcome to ${data.orgName}! 🎉
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi ${data.memberName},
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      You've successfully joined <strong style="color: #ffffff;">${data.orgName}</strong> on Penworth. 
      Your role is <strong style="color: #facc15;">${data.role}</strong>.
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px; font-size: 16px; color: #ffffff; font-weight: bold;">What you can do now:</p>
      <ul style="margin: 0; padding-left: 20px; color: #94a3b8; line-height: 1.8;">
        <li>View and collaborate on organization projects</li>
        <li>Use shared credits to write books with AI</li>
        <li>Invite co-authors to collaborate</li>
        <li>Export and publish your work</li>
      </ul>
    </div>
    
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <a href="${data.dashboardLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 12px;">
            Go to Dashboard
          </a>
        </td>
      </tr>
    </table>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `Welcome to ${data.orgName} on Penworth!`,
    html: emailWrapper(content),
  });
}

export interface RoleChangeEmailData {
  memberName: string;
  orgName: string;
  oldRole: string;
  newRole: string;
  changedBy: string;
}

export async function sendRoleChangeEmail(to: string, data: RoleChangeEmailData) {
  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      Your role has been updated
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi ${data.memberName},
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Your role in <strong style="color: #ffffff;">${data.orgName}</strong> has been updated by ${data.changedBy}.
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 8px 0;">
            <span style="color: #64748b;">Previous role:</span>
            <span style="color: #94a3b8; margin-left: 8px;">${data.oldRole}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0;">
            <span style="color: #64748b;">New role:</span>
            <span style="color: #facc15; margin-left: 8px; font-weight: bold;">${data.newRole}</span>
          </td>
        </tr>
      </table>
    </div>
    
    <p style="margin: 0; font-size: 14px; color: #64748b;">
      If you have questions about this change, please contact your organization admin or 
      <a href="mailto:${SUPPORT_EMAIL}" style="color: #facc15;">reach out to support</a>.
    </p>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `Your role in ${data.orgName} has been updated`,
    html: emailWrapper(content),
  });
}

export interface RemovedFromOrgEmailData {
  memberName: string;
  orgName: string;
  removedBy: string;
}

export async function sendRemovedFromOrgEmail(to: string, data: RemovedFromOrgEmailData) {
  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      You've been removed from ${data.orgName}
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi ${data.memberName},
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      ${data.removedBy} has removed you from <strong style="color: #ffffff;">${data.orgName}</strong> on Penworth.
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      You no longer have access to the organization's projects or shared credits. 
      Any personal projects you created remain in your personal account.
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 14px; color: #94a3b8;">
        You can still use Penworth with your personal account. 
        Start a new book or continue working on your existing projects.
      </p>
    </div>
    
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <a href="https://new.penworth.ai/dashboard" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 12px;">
            Go to My Dashboard
          </a>
        </td>
      </tr>
    </table>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `You've been removed from ${data.orgName}`,
    html: emailWrapper(content),
  });
}

export interface CoAuthorInviteEmailData {
  inviteeName: string;
  inviterName: string;
  bookTitle: string;
  inviteLink: string;
}

export async function sendCoAuthorInviteEmail(to: string, data: CoAuthorInviteEmailData) {
  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      You're invited to co-author a book! 📚
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi${data.inviteeName ? ` ${data.inviteeName}` : ''},
    </p>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      <strong style="color: #ffffff;">${data.inviterName}</strong> wants you to collaborate on their book:
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center;">
      <p style="margin: 0; font-size: 24px; color: #facc15; font-weight: bold;">
        "${data.bookTitle}"
      </p>
    </div>
    
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      As a co-author, you'll be able to:
    </p>
    <ul style="margin: 0 0 24px; padding-left: 20px; color: #94a3b8; line-height: 1.8;">
      <li>Edit chapters and add content</li>
      <li>Use AI assistance for writing</li>
      <li>Export drafts for review</li>
      <li>Be credited as co-author when published</li>
    </ul>
    
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <a href="${data.inviteLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 12px;">
            Accept & Start Writing
          </a>
        </td>
      </tr>
    </table>
    
    <p style="margin: 24px 0 0; font-size: 14px; color: #64748b; text-align: center;">
      Don't have a Penworth account? One will be created for you when you accept.
    </p>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `${data.inviterName} wants you to co-author "${data.bookTitle}"`,
    html: emailWrapper(content),
  });
}

// Weekly digest email for org admins
export interface OrgDigestEmailData {
  adminName: string;
  orgName: string;
  stats: {
    newMembers: number;
    booksCreated: number;
    booksPublished: number;
    creditsUsed: number;
    creditsRemaining: number;
  };
  topContributors: { name: string; books: number }[];
  dashboardLink: string;
}

export async function sendOrgDigestEmail(to: string, data: OrgDigestEmailData) {
  const content = `
    <h1 style="margin: 0 0 16px; font-size: 28px; font-weight: bold; color: #ffffff;">
      Weekly Update for ${data.orgName}
    </h1>
    <p style="margin: 0 0 24px; font-size: 16px; color: #94a3b8; line-height: 1.6;">
      Hi ${data.adminName}, here's what happened this week:
    </p>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 12px; text-align: center; border-right: 1px solid #334155;">
            <div style="font-size: 32px; font-weight: bold; color: #facc15;">${data.stats.newMembers}</div>
            <div style="font-size: 12px; color: #64748b;">New Members</div>
          </td>
          <td style="padding: 12px; text-align: center; border-right: 1px solid #334155;">
            <div style="font-size: 32px; font-weight: bold; color: #22c55e;">${data.stats.booksCreated}</div>
            <div style="font-size: 12px; color: #64748b;">Books Created</div>
          </td>
          <td style="padding: 12px; text-align: center;">
            <div style="font-size: 32px; font-weight: bold; color: #3b82f6;">${data.stats.booksPublished}</div>
            <div style="font-size: 12px; color: #64748b;">Published</div>
          </td>
        </tr>
      </table>
    </div>
    
    <div style="background-color: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px; font-size: 14px; color: #64748b;">Credit Usage</p>
      <p style="margin: 0; font-size: 24px; color: #ffffff;">
        <span style="color: #facc15;">${data.stats.creditsUsed.toLocaleString()}</span> used · 
        <span style="color: #94a3b8;">${data.stats.creditsRemaining.toLocaleString()}</span> remaining
      </p>
    </div>
    
    ${data.topContributors.length > 0 ? `
    <div style="margin-bottom: 24px;">
      <p style="margin: 0 0 12px; font-size: 16px; color: #ffffff; font-weight: bold;">Top Contributors</p>
      ${data.topContributors.map((c, i) => `
        <div style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid #334155;">
          <span style="color: #facc15; font-weight: bold; margin-right: 12px;">#${i + 1}</span>
          <span style="color: #94a3b8;">${c.name}</span>
          <span style="margin-left: auto; color: #64748b;">${c.books} books</span>
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <a href="${data.dashboardLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #facc15, #eab308); color: #0f172a; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 12px;">
            View Full Dashboard
          </a>
        </td>
      </tr>
    </table>
  `;

  return getResend().emails.send({
    from: FROM_EMAIL,
    bcc: FOUNDER_BCC,
    to,
    subject: `[${data.orgName}] Weekly Update - ${data.stats.booksCreated} books created`,
    html: emailWrapper(content),
  });
}
