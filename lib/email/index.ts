import { Resend } from 'resend';
import { emailTemplates } from './templates';

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

// All user-facing email is branded from support@ so replies land in the same
// inbox the user would think to write to if they hit a problem. Marketing or
// product announcements still use this address — if we ever need a separate
// 'hello@' identity we add a second helper; we don't scatter froms.
const FROM_EMAIL = 'Penworth <support@penworth.ai>';
const REPLY_TO = 'support@penworth.ai';

// BCC every outbound so the founder has a complete ledger of system mail.
// This is strictly BCC — the recipient never sees it. Never put this address
// in any client-visible UI, footer, "contact us" block, or From field.
const FOUNDER_BCC = ['nawras@penworth.ai'];

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

async function sendEmail({ to, subject, html, replyTo = REPLY_TO }: SendEmailOptions) {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      replyTo: replyTo,
      bcc: FOUNDER_BCC,
    });

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Email service error:', err);
    return { success: false, error: err };
  }
}

// Exported email functions

export async function sendWelcomeEmail(email: string, userName: string, referralCode: string) {
  const template = emailTemplates.welcome(userName, referralCode);
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendReferralSignupNotification(
  referrerEmail: string,
  referrerName: string,
  refereeName: string
) {
  const template = emailTemplates.referralSignup(referrerName, refereeName);
  return sendEmail({
    to: referrerEmail,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendCreditsEarnedEmail(
  email: string,
  userName: string,
  credits: number,
  refereeName: string
) {
  const template = emailTemplates.creditsEarned(userName, credits, refereeName);
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendCollaborationInvite(
  email: string,
  inviterName: string,
  bookTitle: string,
  role: string,
  inviteToken: string
) {
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai'}/invite/${inviteToken}`;
  const template = emailTemplates.collaborationInvite(inviterName, bookTitle, role, inviteUrl);
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendBookCompletedEmail(email: string, userName: string, bookTitle: string) {
  const template = emailTemplates.bookCompleted(userName, bookTitle);
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendOrganizationInvite(
  email: string,
  inviterName: string,
  orgName: string,
  role: string,
  inviteToken: string
) {
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://new.penworth.ai'}/org-invite/${inviteToken}`;
  const template = emailTemplates.organizationInvite(inviterName, orgName, role, inviteUrl);
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
  });
}

export async function sendMarketplaceSaleNotification(
  sellerEmail: string,
  sellerName: string,
  bookTitle: string,
  buyerName: string,
  amount: number
) {
  const template = emailTemplates.marketplaceSale(sellerName, bookTitle, buyerName, amount);
  return sendEmail({
    to: sellerEmail,
    subject: template.subject,
    html: template.html,
  });
}

export default {
  sendWelcomeEmail,
  sendReferralSignupNotification,
  sendCreditsEarnedEmail,
  sendCollaborationInvite,
  sendBookCompletedEmail,
  sendOrganizationInvite,
  sendMarketplaceSaleNotification,
};
