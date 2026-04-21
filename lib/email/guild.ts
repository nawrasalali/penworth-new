import { Resend } from 'resend';

// Lazy-init: env vars are not guaranteed to be available at module-load
// during Next build's page-data collection phase. Instantiating Resend at
// top-level crashes the build with "Missing API key" even when the var
// is configured in Vercel, because the build's static analysis phase
// sometimes executes module-load code before envs are injected.
// Instantiate on first call instead.
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

const FROM_EMAIL = 'The Penworth Guild <guild@penworth.ai>';
const REPLY_TO = 'guild@penworth.ai';
const GUILD_URL = 'https://guild.penworth.ai';

// BCC the founder on every Guild email. Strictly BCC — recipients never see.
const FOUNDER_BCC = ['nawras@penworth.ai'];

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
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      replyTo: REPLY_TO,
      bcc: FOUNDER_BCC,
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
// Voice interview invitation (sent when admin Accepts a pending application)
// ---------------------------------------------------------------------------

export async function sendGuildInterviewInvitationEmail(params: {
  email: string;
  fullName: string;
  applicationId: string;
  language: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://penworth.ai';
  const bookingUrl = `${appUrl}/guild/interview/schedule?application=${encodeURIComponent(params.applicationId)}`;
  return sendGuildEmail({
    to: params.email,
    subject: "You're invited to interview for The Penworth Guild",
    html: interviewInvitationTemplate(params.fullName, bookingUrl, params.language),
  });
}

// ---------------------------------------------------------------------------
// Post-interview code reveal (sent when admin passes the rubric)
// ---------------------------------------------------------------------------

export async function sendGuildPostInterviewCodeEmail(params: {
  email: string;
  displayName: string;
  referralCode: string;
  tier: string;
}) {
  return sendGuildEmail({
    to: params.email,
    subject: 'Welcome to The Penworth Guild',
    html: postInterviewCodeTemplate(params.displayName, params.referralCode, params.tier),
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
        The Penworth Guild &middot; A.C.N. 675 668 710 PTY LTD &middot; Adelaide, Australia<br />
        &ldquo;The craft advances through those who advance the craft.&rdquo;
      </div>
    </div>
  </body>
</html>`;
}

function applicationReceivedTemplate(fullName: string, applicationId: string): string {
  const firstName = extractFirstName(fullName);
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
  const firstName = extractFirstName(fullName);
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

function interviewInvitationTemplate(fullName: string, bookingUrl: string, language: string): string {
  const firstName = extractFirstName(fullName);
  const languageName = LANGUAGE_NAMES[language] || 'your native language';
  return wrapEmail(`
    <h1 class="serif" style="font-size: 32px; line-height: 1.2; margin: 0 0 16px;">
      You're invited to interview, ${escape(firstName)}.
    </h1>
    <p style="font-size: 16px; line-height: 1.6; color: #c9c2b0;">
      Your application has passed the first round. The next step is a <strong>10-minute voice interview</strong> with the Guild's AI interviewer. This is the gate that decides whether you join the Guild.
    </p>
    <div style="background: #0f1424; border: 1px solid #1e2436; border-radius: 8px; padding: 24px; margin: 24px 0;">
      <div style="color: #d4af37; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px;">
        What to know
      </div>
      <ul style="font-size: 15px; line-height: 1.7; color: #c9c2b0; padding-left: 20px; margin: 0;">
        <li>Conducted in <strong>${escape(languageName)}</strong></li>
        <li>Takes 10 minutes</li>
        <li>No knowledge to study for &mdash; it's a real conversation</li>
        <li>You can reschedule up to twice</li>
      </ul>
    </div>
    <div style="margin: 32px 0;">
      <a href="${bookingUrl}" class="btn">Book your voice interview</a>
    </div>
    <p class="muted">
      The interview covers your background, your motivation, who you'd introduce to Penworth, and your understanding of the product. Speak naturally &mdash; we're not testing you on anything. Your referral code is revealed only after the Guild Council confirms your acceptance.
    </p>
  `);
}

function postInterviewCodeTemplate(displayName: string, referralCode: string, tier: string): string {
  const firstName = extractFirstName(displayName);
  const tierLabel = TIER_LABELS[tier] || 'Apprentice';
  return wrapEmail(`
    <h1 class="serif" style="font-size: 36px; line-height: 1.2; margin: 0 0 16px;">
      Welcome to the Guild, <span class="gold">${escape(firstName)}</span>.
    </h1>
    <p style="font-size: 18px; line-height: 1.6; color: #e7e2d4;">
      You are now ${tierLabel === 'Apprentice' ? 'an' : 'a'} <strong>${escape(tierLabel)}</strong> of The Penworth Guild.
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
        Share this code with anyone. When they subscribe to Penworth, you earn commission for 12 months.
      </div>
    </div>
    <div style="margin: 32px 0;">
      <a href="https://guild.penworth.ai/dashboard" class="btn">Enter your dashboard</a>
    </div>
  `);
}

function declineTemplate(fullName: string): string {
  const firstName = extractFirstName(fullName);
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

const TIER_LABELS: Record<string, string> = {
  apprentice: 'Apprentice',
  journeyman: 'Journeyman',
  artisan: 'Artisan',
  master: 'Master',
  fellow: 'Fellow',
};

/**
 * Extract the applicant's actual first name, skipping common title prefixes
 * like "Mr.", "Mrs.", "Dr.", etc. Falls back to the full name if nothing
 * useful can be extracted.
 */
function extractFirstName(fullName: string): string {
  const TITLES = new Set([
    'mr', 'mrs', 'ms', 'mx', 'miss',
    'dr', 'prof', 'professor',
    'sir', 'madam', 'lord', 'lady',
    'rev', 'reverend', 'fr', 'father', 'sr', 'sister', 'br', 'brother',
    'hon', 'honourable', 'honorable',
    'sheikh', 'sayyid', 'sayed', 'hajji', 'hajj',
  ]);
  const cleaned = (fullName || '').trim();
  if (!cleaned) return 'there';
  const parts = cleaned.split(/\s+/);
  for (const part of parts) {
    const stripped = part.replace(/[.,]/g, '').toLowerCase();
    if (!TITLES.has(stripped) && part.length > 0) {
      // Strip trailing punctuation on the actual name word
      return part.replace(/[.,;:]+$/, '');
    }
  }
  // Entire name was titles only — fall back to cleaned full name
  return cleaned.replace(/[.,;:]+$/, '');
}

function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
