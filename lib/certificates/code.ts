/**
 * Penworth Guild Foundations certificate code system.
 *
 * Code format: PWG-XXXX-XXXX where each X is a Crockford base32 character
 * (0123456789ABCDEFGHJKMNPQRSTVWXYZ — no I/L/O/U to avoid visual ambiguity).
 *
 * Total entropy: 32^8 ≈ 1.1 × 10^12 — collision-free at any plausible scale.
 *
 * The HMAC signature binds the code to the member and the issued_at timestamp:
 *   hmac = HMAC-SHA256(secret, `${member_id}|${code}|${issued_at_iso}`).hex()
 *
 * The verify endpoint recomputes the HMAC against the stored fields and
 * rejects mismatches — so even if a code is leaked, an attacker can't
 * forge a different name or date for it.
 */

import { createHmac, randomBytes } from 'crypto';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_PREFIX = 'PWG';
export const CODE_REGEX = /^PWG-[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/;

/** Generate one Crockford base32 character cryptographically. */
function pickChar(): string {
  // Reject-sample to avoid modulo bias: 256 % 32 = 0 ✓ (no bias actually,
  // but use full byte for simplicity — 32 divides 256 evenly).
  const b = randomBytes(1)[0];
  return CROCKFORD_ALPHABET[b % 32];
}

/**
 * Generate a fresh certificate code in PWG-XXXX-XXXX format.
 * No DB collision check here — the unique constraint on
 * guild_certificates.code is the source of truth; on the rare
 * collision the INSERT fails and the caller retries.
 */
export function generateCode(): string {
  let s = CODE_PREFIX + '-';
  for (let i = 0; i < 4; i++) s += pickChar();
  s += '-';
  for (let i = 0; i < 4; i++) s += pickChar();
  return s;
}

/**
 * Compute the HMAC-SHA256 signature that binds a code to the member and
 * issued_at timestamp. Returns lowercase hex.
 */
export function signCode(memberId: string, code: string, issuedAtIso: string, secret: string): string {
  if (!secret || secret.length < 16) {
    throw new Error('CERTIFICATE_HMAC_SECRET is missing or too short (min 16 chars)');
  }
  const payload = `${memberId}|${code}|${issuedAtIso}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time compare for HMAC verification. */
export function verifySignature(
  memberId: string,
  code: string,
  issuedAtIso: string,
  expectedSignature: string,
  secret: string,
): boolean {
  const computed = signCode(memberId, code, issuedAtIso, secret);
  if (computed.length !== expectedSignature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function getHmacSecret(): string {
  const s = process.env.CERTIFICATE_HMAC_SECRET;
  if (!s) {
    throw new Error('CERTIFICATE_HMAC_SECRET env var not set');
  }
  return s;
}
