import crypto from 'crypto';

/**
 * Per-user credential encryption for publishing platform auth.
 *
 * We derive a 32-byte key from PENWORTH_CREDENTIAL_KEY + user_id using HKDF
 * so no two users share an encryption key. Payload is JSON, encrypted with
 * AES-256-GCM. The returned string is base64(iv || authTag || ciphertext).
 *
 * - Never log ciphertext or payload anywhere.
 * - Decrypt only in memory in the publish request path.
 * - If PENWORTH_CREDENTIAL_KEY is missing, we refuse to encrypt/decrypt so
 *   we fail closed instead of silently using a default key.
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended 96-bit nonce
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const key = process.env.PENWORTH_CREDENTIAL_KEY;
  if (!key || key.length < 32) {
    throw new Error('PENWORTH_CREDENTIAL_KEY env var missing or too short (needs 32+ chars)');
  }
  return Buffer.from(key, 'utf8');
}

function deriveUserKey(userId: string): Buffer {
  const master = getMasterKey();
  // HKDF with user_id as info string
  return crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(`pw:cred:${userId}`), 32) as unknown as Buffer;
}

export function encryptCredential(userId: string, payload: Record<string, unknown>): string {
  const key = deriveUserKey(userId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptCredential<T = Record<string, unknown>>(userId: string, encrypted: string): T {
  const key = deriveUserKey(userId);
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
