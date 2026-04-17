import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'The Penworth Guild <guild@penworth.ai>';
const REPLY_TO = 'guild@penworth.ai';
const GUILD_URL = 'https://guild.penworth.ai';

interface SendResult {
  success: boolean;
  error?: unknown;
}

async function sendGuildEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      replyTo: REPLY_TO,
    });
    if (error) {
      console.error('[guild email] Send error:', error);
      return { success: false, error };
    }
    return { success: true };
  } catch (err) {
    console.error('[guild email] Exception:', err);
    return { success: false, error: err };
  }
}

// ---------------------------------------------------------------------------
// Application received (status-aware)
// ---------------------------------------------------------------------------

export async function sendGuildApplicationReceivedEmail(params: {
  email: string;
  fullName: string;
  status: 'pending_review' | 'auto_declined';
  applicationId: string;
}) {
  if (params.status === 'auto_declined') {
    return sendGuildEmail({
      to: params.email,
      subject: 'Your Penworth Guild application',
      html: autoDeclinedTemplate(params.fullName),
    });
  }
  return sendGuildEmail({
    to: params.email,
    subject: 'Your application to The Penworth Guild has been received',
    html: applicationReceivedTemplate(params.fullName, params.applicationId),
  });
}

// ---------------------------------------------------------------------------
// Voice interview invitation
// ---------------------------------------------------------------------------

export async function sendGuildInterviewInviteEmail(params: {
  email: string;
  fullName: string;
  bookingUrl: string;
  language: string;
}) {
  return sendGuildEmail({
    to: params.email,
    subject: 'Schedule your Penworth Guild interview',
    html: interviewInviteTemplate(params.fullName, params.bookingUrl, params.language),
  });
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

export async function sendGuildAcceptanceEmail(params: {
  email: string;
  fullName: string;
  referralCode: string;
  dashboardUrl: string;
}) {
  return sendGuildEmail({
    to: params.email,
    subject: 'Welcome to The Penworth Guild',
    html: acceptanceTemplate(params.fullName, params.referralCode, params.dashboardUrl),
  });
}

// ---------------------------------------------------------------------------
// Decline after interview
// ---------------------------------------------------------------------------

export async function sendGuildDeclineEmail(params: {
  email: string;
  fullName: string;
}) {
  return sendGuildEmail({
    to: params.email,
    subject: 'Your Penworth Guild application',
    html: declineTemplate(params.fullName),
  });
}

// ===========================================================================
// HTML TEMPLATES
// All emails share a consistent brand identity: dark background, gold accent,
// serif typography for headlines. Designed for a serious, premium feel.
// ===========================================================================

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; padding: 0; background: #0a0e1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e7e2d4; }
      .container { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
      .serif { font-family: "Georgia", "Times New Roman", serif; }
      .gold { color: #d4af37; }
      .btn { display: inline-block; padding: 14px 28px; background: #d4af37; color: #0a0e1a !important; text-decoration: none; border-radius: 6px; font-weight: 500; }
      .btn-outline { display: inline-block; padding: 14px 28px; border: 1px solid #2a3149; color: #e7e2d4; text-decoration: none; border-radius: 6px; font-weight: 500; }
      hr { border: 0; height: 1px; background: #1e2436; margin: 32px 0; }
      .muted { color: #8a8370; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div style="margin-bottom: 40px;">
        <div style="font-family: Georgia, serif; font-size: 20px; letter-spacing: 0.02em;">
          The Penworth <span class="gold">Guild</span>
        </div>
      </div>
      ${body}
      <hr />
      <div class="muted">
        The Penworth Guild · Penworth.ai · A.C.N. 675 668 710 PTY LTD · Adelaide, Australia<br />
        &ldquo;The craft advances through those who advance the craft.&rdquo;
      </div>
    </div>
  </body>
</html>`;
}

function applicationReceivedTemplate(fullName: string, applicationId: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  return wrapEmail(`
    <h1 class="serif" style="font-size: 32px; line-height: 1.2; margin: 0 0 16px;">
      Your application is with the Guild Council, ${escape(firstName)}.
    </h1>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      We've received your application to The Penworth Guild. Thank you for considering this path.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      Our automated review runs immediately. Within the next <strong>30 minutes</strong>, you'll receive a second email with one of two outcomes:
    </p>
    <ol style="font-size: 16px; line-height: 1.8; color: #c9c2b0; padding-left: 20px;">
      <li>An invitation to schedule your <strong>10-minute voice interview</strong>, conducted in your native language by our AI interviewer.</li>
      <li>A decision that your application isn't the right fit at this time — with the option to reapply in 90 days.</li>
    </ol>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      While you wait, here are three things to know:
    </p>
    <ul style="font-size: 15px; line-height: 1.7; color: #c9c2b0; padding-left: 20px;">
      <li>The Guild has five tiers — Apprentice, Journeyman, Artisan, Master, Fellow — and you climb by retaining the authors you bring in.</li>
      <li>You earn commission on first-tier referrals only, for 12 consecutive months per person, paid the last business day of each month.</li>
      <li>Your seven AI support agents begin work the moment you're accepted.</li>
    </ul>
    <div style="margin: 32px 0;">
      <a href="${GUILD_URL}/ladder" class="btn-outline">View the five tiers</a>
    </div>
    <p class="muted">Application ID: ${escape(applicationId)}</p>
  `);
}

function autoDeclinedTemplate(fullName: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  return wrapEmail(`
    <h1 class="serif" style="font-size: 32px; line-height: 1.2; margin: 0 0 16px;">
      Thank you for your interest, ${escape(firstName)}.
    </h1>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      We've carefully reviewed your application to The Penworth Guild.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      On this occasion, the Guild is not accepting your application. This is not a reflection on your worth as a person or a marketer — it simply means the signal we received was not enough for us to move forward today.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      You are welcome to <strong>reapply in 90 days</strong>. A stronger motivation statement, links to public work you've done, or a clearer picture of who you'd introduce to Penworth will all help.
    </p>
    <div style="margin: 32px 0;">
      <a href="${GUILD_URL}" class="btn-outline">Learn more about the Guild</a>
    </div>
  `);
}

function interviewInviteTemplate(fullName: string, bookingUrl: string, language: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  const languageName = LANGUAGE_NAMES[language] || 'your native language';
  return wrapEmail(`
    <h1 class="serif" style="font-size: 32px; line-height: 1.2; margin: 0 0 16px;">
      You're invited to interview, ${escape(firstName)}.
    </h1>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      Your application has passed the first round. The next step is a <strong>10-minute voice interview</strong> with the Guild's AI interviewer.
    </p>
    <div style="background: #0f1424; border: 1px solid #1e2436; border-radius: 8px; padding: 24px; margin: 24px 0;">
      <div style="color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px;">
        What to know
      </div>
      <ul style="font-size: 15px; line-height: 1.7; color: #c9c2b0; padding-left: 20px; margin: 0;">
        <li>Conducted in <strong>${escape(languageName)}</strong></li>
        <li>Takes 10 minutes</li>
        <li>No knowledge to study for — it's a real conversation</li>
        <li>You can reschedule up to twice</li>
      </ul>
    </div>
    <div style="margin: 32px 0;">
      <a href="${bookingUrl}" class="btn">Schedule My Interview</a>
    </div>
    <p class="muted">
      The interview covers your background, your motivation, who you'd introduce to Penworth, and your understanding of the product. Speak naturally — we're not testing you on anything.
    </p>
  `);
}

function acceptanceTemplate(fullName: string, referralCode: string, dashboardUrl: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  return wrapEmail(`
    <h1 class="serif" style="font-size: 36px; line-height: 1.2; margin: 0 0 16px;">
      Welcome to the Guild, <span class="gold">${escape(firstName)}</span>.
    </h1>
    <p style="font-size: 18px; line-height: 1.6; color: #e7e2d4;">
      You are now an <strong>Apprentice</strong> of The Penworth Guild.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      The Guild Council reviewed your interview and voted to accept you. Your dashboard is live. Your seven AI agents are ready. Your first steps await.
    </p>
    <div style="background: #0f1424; border: 1px solid #d4af37; border-radius: 8px; padding: 28px; margin: 28px 0; text-align: center;">
      <div style="color: #8a8370; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">
        Your referral code
      </div>
      <div class="serif gold" style="font-size: 32px; letter-spacing: 0.05em;">
        ${escape(referralCode)}
      </div>
      <div class="muted" style="margin-top: 12px; font-size: 13px;">
        Share this code with anyone. When they subscribe to Penworth, you earn 20% for 12 months.
      </div>
    </div>
    <div style="margin: 32px 0;">
      <a href="${dashboardUrl}" class="btn">Enter Your Dashboard</a>
    </div>
    <p style="font-size: 15px; line-height: 1.6; color: #c9c2b0;">
      <strong>First, do three things:</strong>
    </p>
    <ol style="font-size: 15px; line-height: 1.8; color: #c9c2b0; padding-left: 20px;">
      <li>Complete the 10-minute onboarding flow inside your dashboard.</li>
      <li>Write your first Penworth document (free — included with Apprentice tier) so you can speak from experience.</li>
      <li>Meet Scout, your first AI agent. It audits the online presence you shared with us and builds your first growth plan.</li>
    </ol>
    <p class="muted">
      Your tier: Apprentice · Your commission rate: 20% · Your ladder: Apprentice → Journeyman → Artisan → Master → Fellow.
    </p>
  `);
}

function declineTemplate(fullName: string): string {
  const firstName = fullName.split(' ')[0] || fullName;
  return wrapEmail(`
    <h1 class="serif" style="font-size: 32px; line-height: 1.2; margin: 0 0 16px;">
      Thank you for speaking with us, ${escape(firstName)}.
    </h1>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      The Guild Council has reviewed your interview carefully.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      On this occasion, your application was not successful. We know this is not the outcome you hoped for, and we want you to know we do not make these decisions lightly. Every applicant deserves our full consideration — yours had it.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      You are welcome to reapply in <strong>90 days</strong>. The Guild grows and its criteria evolve; what wasn't right today may be right the next time you apply.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      In the meantime, Penworth itself is open to you as an author. If you've written a book in you, we'd love to help you write it.
    </p>
    <div style="margin: 32px 0;">
      <a href="https://penworth.ai" class="btn-outline">Write a book with Penworth</a>
    </div>
  `);
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  ar: 'Arabic',
  pt: 'Portuguese',
  fr: 'French',
  hi: 'Hindi',
  id: 'Indonesian',
  vi: 'Vietnamese',
  bn: 'Bengali',
  ru: 'Russian',
  zh: 'Chinese',
};

function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
