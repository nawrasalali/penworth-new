'use client';

import { useEffect } from 'react';

/**
 * Captures an AUTHOR referral code from the URL and stores it in a cookie
 * lasting 30 days. On signup, the auth/callback route reads this cookie and
 * applies the code via the standard /api/referrals POST flow.
 *
 * Distinct from GuildRefCapture: that one handles GUILD-prefixed codes
 * (Guildmember commission attribution). This one handles plain
 * 8-character author codes (e.g. "DEEBAFBB") that award credits, not cash.
 *
 * Codes that look like Guild codes (start with "GUILD-") are left alone
 * here and picked up by GuildRefCapture instead.
 *
 * Mount once on the public marketing pages and the signup page itself, so
 * users who hit /signup?ref=XYZ have the code persisted before they finish
 * confirming their email.
 */
export default function AuthorRefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (!ref) return;

      const normalized = ref.trim().toUpperCase();
      // Guild codes are handled by GuildRefCapture
      if (normalized.startsWith('GUILD-')) return;
      // Author codes: 6-12 alphanumeric chars (current format is 8 hex chars,
      // small allowance either side for future format flexibility)
      if (!/^[A-Z0-9]{6,12}$/.test(normalized)) return;

      const maxAgeSeconds = 60 * 60 * 24 * 30; // 30 days
      const domainAttr = getCookieDomain();
      document.cookie = `penworth_author_ref=${encodeURIComponent(normalized)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${domainAttr}`;

      try {
        localStorage.setItem('penworth_author_ref', normalized);
        localStorage.setItem('penworth_author_ref_at', String(Date.now()));
      } catch {
        // localStorage may be blocked; cookie is the canonical store
      }
    } catch (err) {
      console.error('[AuthorRefCapture]', err);
    }
  }, []);

  return null;
}

function getCookieDomain(): string {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (host.endsWith('penworth.ai')) return '; domain=.penworth.ai; secure';
  return '';
}
