import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptCredential } from './credentials';
import type { StoredOAuthToken } from './oauth-providers';

/**
 * Load + decrypt an active OAuth credential for (user, platform slug).
 * Returns null if no active credential exists. Throws only on decryption
 * failure (corrupted payload / missing master key).
 *
 * Caller is responsible for checking token expiry and triggering refresh
 * if the provider supports it.
 */
export async function loadActiveCredential(
  supabase: SupabaseClient,
  userId: string,
  platformSlug: string,
): Promise<{ credentialId: string; platformId: string; token: StoredOAuthToken } | null> {
  const { data: platform } = await supabase
    .from('publishing_platforms')
    .select('id')
    .eq('slug', platformSlug)
    .single();
  if (!platform) return null;

  const { data: cred } = await supabase
    .from('publishing_credentials')
    .select('id, encrypted_payload, status, expires_at')
    .eq('user_id', userId)
    .eq('platform_id', platform.id)
    .eq('status', 'active')
    .maybeSingle();

  if (!cred) return null;

  const token = decryptCredential<StoredOAuthToken>(userId, cred.encrypted_payload);

  // Stamp last_used_at — best-effort, non-fatal
  supabase
    .from('publishing_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', cred.id)
    .then(() => undefined, () => undefined);

  return { credentialId: cred.id, platformId: platform.id, token };
}
