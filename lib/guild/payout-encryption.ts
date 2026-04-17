import crypto from 'crypto';

/**
 * Payout-detail encryption for Guild members.
 *
 * We store Wise email addresses and USDT wallet addresses in
 * guild_members.payout_details_encrypted. Encryption uses AES-256-GCM with a
 * per-guildmember key derived via HKDF(PENWORTH_CREDENTIAL_KEY, guildmember_id).
 * Namespaced with "pw:guild-payout:${id}" so keys can't collide with
 * publishing-credential keys that use the same master secret.
 *
 * Plaintext shape is { value: string }. We never log the ciphertext or the
 * plaintext. Masking is computed at encryption time so the caller can store a
 * display-safe last-4 mask alongside without ever round-tripping the plaintext
 * again.
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const key = process.env.PENWORTH_CREDENTIAL_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'PENWORTH_CREDENTIAL_KEY env var missing or too short (needs 32+ chars)',
    );
  }
  return Buffer.from(key, 'utf8');
}

function deriveKey(guildmemberId: string): Buffer {
  const master = getMasterKey();
  return crypto.hkdfSync(
    'sha256',
    master,
    Buffer.alloc(0),
    Buffer.from(`pw:guild-payout:${guildmemberId}`),
    32,
  ) as unknown as Buffer;
}

export interface PayoutDetails {
  value: string; // Wise email address OR USDT wallet address
}

export function encryptPayoutDetails(
  guildmemberId: string,
  details: PayoutDetails,
): string {
  if (!details.value || details.value.length < 3) {
    throw new Error('payout details value too short');
  }
  const key = deriveKey(guildmemberId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.from(JSON.stringify(details), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptPayoutDetails(
  guildmemberId: string,
  encrypted: string,
): PayoutDetails {
  const key = deriveKey(guildmemberId);
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as PayoutDetails;
}

/**
 * Builds a display-safe mask for payout destinations.
 * Wise emails: j***@e******.com   (first char, last 4 of domain stem, tld)
 * USDT wallets: 0x1234…abcd       (first 6, ellipsis, last 4)
 */
export function maskPayoutDestination(method: 'wise' | 'usdt', value: string): string {
  const v = value.trim();
  if (method === 'wise') {
    const at = v.indexOf('@');
    if (at <= 0 || at === v.length - 1) return '****@****.***';
    const local = v.slice(0, at);
    const domain = v.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    const stem = dot > 0 ? domain.slice(0, dot) : domain;
    const tld = dot > 0 ? domain.slice(dot) : '';
    const maskedLocal = local[0] + '*'.repeat(Math.max(2, local.length - 1));
    const maskedStem =
      stem.length <= 2
        ? '*'.repeat(stem.length)
        : stem[0] + '*'.repeat(stem.length - 1);
    return `${maskedLocal}@${maskedStem}${tld}`;
  }
  // usdt wallet
  if (v.length < 10) return '****';
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

/**
 * Safe variant for code paths where we have only the ciphertext.
 * Returns a generic mask if decryption fails or details are absent.
 */
export function maskPayoutDestinationSafe(
  method: string,
  guildmemberId: string,
  encrypted: string | null | undefined,
): string {
  if (!encrypted) return method === 'wise' ? '****@****.***' : '0x…';
  if (method !== 'wise' && method !== 'usdt') return '—';
  try {
    const { value } = decryptPayoutDetails(guildmemberId, encrypted);
    return maskPayoutDestination(method, value);
  } catch {
    return method === 'wise' ? '****@****.***' : '0x…';
  }
}
