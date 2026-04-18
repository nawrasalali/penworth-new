/**
 * Support contact form endpoint. Public — no auth required because a user
 * might be filing a ticket about being unable to log in.
 *
 * Hardening:
 * - Input validation (name + valid email + non-empty message under 5000 chars).
 * - Per-IP rate limit: 5 messages per hour per IP, in-memory sliding window.
 *   Good enough against casual abuse; if spam becomes a real problem we
 *   swap this for Upstash.
 * - Zero DB writes — if Resend is down, we tell the user and log it. We do
 *   NOT persist unsent messages in Supabase; that'd create a "support backlog"
 *   table nobody watches, which is worse than a user retrying.
 * - Plaintext-body <pre> so HTML injection in the message can't render.
 *   Author hyperlinks/addresses escaped into safe text.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';

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

// In-memory rate limit store. Reset on cold start, which is fine — scraping
// attacks hit the same instance repeatedly and will be slowed; legitimate
// users send 1-2 messages and never see this.
const rateLimitStore = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitStore.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return true;
}

// Basic HTML escape so user-supplied name/email/message can't inject markup
// into the email we render. Resend emails are HTML by default.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many messages. Please try again later.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim();
    const message = String(body?.message || '').trim();

    if (!name || name.length < 1 || name.length > 200) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }
    if (!email || !EMAIL_RE.test(email) || email.length > 320) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (!message || message.length < 1 || message.length > 5000) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    // Try to attribute the ticket to a logged-in user if one's present.
    // Non-fatal if not — the form is available unauthenticated too.
    let attributedUserId: string | null = null;
    let attributedUserEmail: string | null = null;
    let attributedPlan: string | null = null;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        attributedUserId = user.id;
        attributedUserEmail = user.email || null;
        const { data: profile } = await supabase
          .from('profiles')
          .select('plan')
          .eq('id', user.id)
          .maybeSingle();
        attributedPlan = profile?.plan || null;
      }
    } catch {
      // ignore — anonymous ticket is fine
    }

    const userAgent = req.headers.get('user-agent') || 'unknown';
    const referer = req.headers.get('referer') || 'unknown';
    const timestamp = new Date().toISOString();

    const attributionBlock = attributedUserId
      ? `
        <tr><td><strong>Signed in as</strong></td><td>${esc(attributedUserEmail || '')} (${esc(attributedUserId)})</td></tr>
        <tr><td><strong>Plan</strong></td><td>${esc(attributedPlan || 'free')}</td></tr>
      `
      : `<tr><td><strong>Signed in</strong></td><td>No (anonymous submission)</td></tr>`;

    const html = `
      <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1B3A57; margin-top: 0;">New support message</h2>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 4px 12px 4px 0;"><strong>From</strong></td><td style="padding: 4px 0;">${esc(name)} &lt;${esc(email)}&gt;</td></tr>
          ${attributionBlock}
          <tr><td style="padding: 4px 12px 4px 0;"><strong>Time</strong></td><td style="padding: 4px 0;">${esc(timestamp)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0;"><strong>IP</strong></td><td style="padding: 4px 0;">${esc(ip)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0;"><strong>Referer</strong></td><td style="padding: 4px 0;">${esc(referer)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; vertical-align: top;"><strong>UA</strong></td><td style="padding: 4px 0; font-size: 11px; color: #666;">${esc(userAgent)}</td></tr>
        </table>

        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

        <h3 style="color: #1B3A57; font-size: 14px; margin-bottom: 8px;">Message</h3>
        <pre style="background: #f5f5f5; padding: 16px; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; font-family: -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.6; margin: 0;">${esc(message)}</pre>

        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Reply to this email to respond directly to ${esc(name)}.
        </p>
      </div>
    `;

    const subjectTag = attributedPlan ? `[${attributedPlan}]` : '[anon]';

    await getResend().emails.send({
      from: 'Penworth Support <support@penworth.ai>',
      to: 'support@penworth.ai',
      bcc: ['nawras@penworth.ai'],
      replyTo: email,
      subject: `${subjectTag} ${name}: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[support/contact] send failed:', err?.message || err);
    return NextResponse.json(
      { error: 'Could not send your message. Please email support@penworth.ai directly.' },
      { status: 500 },
    );
  }
}
