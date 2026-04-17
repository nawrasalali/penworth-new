'use client';

import { useEffect } from 'react';

/**
 * Captures a Guild referral code from the URL and stores it in a cookie
 * that lasts 30 days. On signup, the server-side auth callback reads this
 * cookie and creates a guild_referrals row.
 *
 * Mount this component once in the root layout or on the landing page.
 * It does nothing if no ?ref= is present or if the code isn't a GUILD- code.
 */
export default function GuildRefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref') || params.get('guild_ref');
      if (!ref) return;

      const normalized = ref.trim().toUpperCase();
      if (!normalized.startsWith('GUILD-')) return;
      if (normalized.length > 32) return; // anti-spam

      // Set cookie on .penworth.ai so it's accessible across subdomains
      const maxAgeSeconds = 60 * 60 * 24 * 30; // 30 days
      const domainAttr = getCookieDomain();
      document.cookie = `penworth_ref=${encodeURIComponent(normalized)}; path=/; max-age=${maxAgeSeconds}; samesite=lax${domainAttr}`;

      // Also echo to localStorage for clients that block cross-subdomain cookies
      try {
        localStorage.setItem('penworth_ref', normalized);
        localStorage.setItem('penworth_ref_at', String(Date.now()));
      } catch {}
    } catch (err) {
      // Swallow — this is best-effort
      console.error('[GuildRefCapture]', err);
    }
  }, []);

  return null;
}

function getCookieDomain(): string {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  // Only set the domain attribute on the real penworth.ai domain
  if (host.endsWith('penworth.ai')) return '; domain=.penworth.ai; secure';
  return '';
}
