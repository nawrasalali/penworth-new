/**
 * Server-side helper for GDPR Article 20 (Right to Data Portability)
 * fulfilment.
 *
 * Given a user_id, this module:
 *   1. Reads every row from every user-scoped table (45 tables as of
 *      migration 018). Each table is tolerated independently — a
 *      failure on one (schema drift, transient DB error) is recorded
 *      and the other tables still export.
 *   2. Reads the user's profile + auth.users metadata.
 *   3. Assembles a single JSON object: {
 *        _metadata: { generated_at, user_id, format_version, ... },
 *        auth: { email, created_at, last_sign_in_at, ... },
 *        profile: { ... },
 *        tables: { [table_name]: [rows] | { error } }
 *      }
 *   4. Uploads to the private `compliance-exports` bucket at
 *      `{user_id}/{export_request_id}.json`.
 *   5. Generates a 7-day signed URL.
 *   6. Returns { success, file_path, file_size_bytes, manifest,
 *      signed_url, signed_url_expires_at } — the admin endpoint uses
 *      these to update the data_exports row and email the user.
 *
 * SCOPE DECISION
 * --------------
 * This first version covers tables with a direct user_id, author_id,
 * or owner_id column. Tables that reference user data transitively
 * (chapters via projects, chapter_regenerations via projects, etc.)
 * are NOT walked transitively in this pass. A TODO entry is added
 * to the manifest so the admin knows additional data exists that
 * could be exported manually on request.
 *
 * FAILURE POLICY
 * --------------
 * The overall return type is never `{ success: false }` unless the
 * JSON upload itself fails. Per-table read failures are captured
 * in manifest entries with status='error' and do NOT abort the export.
 * This matches GDPR intent — deliver whatever you can, flag the gaps.
 */

import { createServiceClient } from '@/lib/supabase/service';

// ----------------------------------------------------------------------------
// Table registry
// ----------------------------------------------------------------------------

/**
 * Tables that reference the user by a direct column. Each entry
 * specifies:
 *   - name: table name in public schema
 *   - userColumn: the FK column to filter on
 *
 * Order: alphabetical — the output is deterministic so two exports
 * of the same user at the same time produce identical JSON.
 *
 * To add a new table: append an entry here. The fulfilment loop
 * picks it up automatically. To retire a table, remove the entry
 * (it will stop appearing in exports but existing exports keep
 * working).
 */
interface TableSpec {
  name: string;
  userColumn: 'user_id' | 'author_id' | 'owner_id';
}

const USER_SCOPED_TABLES: ReadonlyArray<TableSpec> = [
  { name: 'ai_sessions', userColumn: 'user_id' },
  { name: 'audiobook_chapters', userColumn: 'user_id' },
  { name: 'collaborators', userColumn: 'owner_id' },
  { name: 'computer_use_sessions', userColumn: 'user_id' },
  { name: 'consent_records', userColumn: 'user_id' },
  { name: 'credit_transactions', userColumn: 'user_id' },
  { name: 'credits_ledger', userColumn: 'user_id' },
  { name: 'data_deletion_requests', userColumn: 'user_id' },
  { name: 'data_exports', userColumn: 'user_id' },
  { name: 'distributor_signups', userColumn: 'user_id' },
  { name: 'event_registrations', userColumn: 'user_id' },
  { name: 'guild_advisor_usage', userColumn: 'user_id' },
  { name: 'guild_applications', userColumn: 'user_id' },
  { name: 'guild_members', userColumn: 'user_id' },
  { name: 'interview_sessions', userColumn: 'user_id' },
  { name: 'marketplace_purchases', userColumn: 'user_id' },
  { name: 'marketplace_reviews', userColumn: 'user_id' },
  { name: 'marketplace_wishlists', userColumn: 'user_id' },
  { name: 'master_distributors', userColumn: 'user_id' },
  { name: 'nora_actions', userColumn: 'user_id' },
  { name: 'nora_conversations', userColumn: 'user_id' },
  { name: 'nora_kb_articles', userColumn: 'author_id' },
  { name: 'org_members', userColumn: 'user_id' },
  { name: 'project_publications', userColumn: 'user_id' },
  { name: 'projects', userColumn: 'user_id' },
  { name: 'publishing_credentials', userColumn: 'user_id' },
  { name: 'publishing_metadata', userColumn: 'user_id' },
  { name: 'publishing_records', userColumn: 'user_id' },
  { name: 'referral_codes', userColumn: 'user_id' },
  { name: 'share_links', userColumn: 'user_id' },
  { name: 'share_tracks', userColumn: 'user_id' },
  { name: 'store_admins', userColumn: 'user_id' },
  { name: 'store_author_credentials', userColumn: 'author_id' },
  { name: 'store_author_profiles', userColumn: 'user_id' },
  { name: 'store_follows', userColumn: 'author_id' },
  { name: 'store_listing_appeals', userColumn: 'author_id' },
  { name: 'store_listings', userColumn: 'author_id' },
  { name: 'store_payouts', userColumn: 'author_id' },
  { name: 'store_pool_shares', userColumn: 'author_id' },
  { name: 'store_publish_drafts', userColumn: 'author_id' },
  { name: 'store_readers', userColumn: 'user_id' },
  { name: 'support_ticket_replies', userColumn: 'author_id' },
  { name: 'support_tickets', userColumn: 'user_id' },
  { name: 'usage', userColumn: 'user_id' },
];

/**
 * Sensitive columns that are redacted from the export output.
 * Publishing credentials are encrypted at rest but still — sending
 * them back in a JSON dump would create a second attack surface.
 */
const REDACTED_COLUMNS_BY_TABLE: Record<string, ReadonlyArray<string>> = {
  publishing_credentials: ['encrypted_password', 'encrypted_api_key', 'encrypted_secret', 'encrypted_token'],
  store_author_credentials: ['encrypted_password', 'encrypted_api_key', 'encrypted_secret', 'encrypted_token'],
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ManifestEntry {
  table_name: string;
  user_column: string;
  status: 'success' | 'error' | 'empty';
  rows_exported: number;
  error?: string;
  timestamp: string;
}

export interface FulfilExportResult {
  success: boolean;
  file_path: string;
  file_size_bytes: number;
  manifest: ManifestEntry[];
  signed_url: string;
  signed_url_expires_at: string;
  error?: string;
}

// ----------------------------------------------------------------------------
// Main entrypoint
// ----------------------------------------------------------------------------

export async function fulfilExportRequest(
  exportRequestId: string,
  userId: string,
): Promise<FulfilExportResult> {
  const admin = createServiceClient();
  const manifest: ManifestEntry[] = [];

  // ---- 1. auth metadata ----
  let authBlock: Record<string, unknown> = {};
  try {
    const { data: authUser, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      manifest.push({
        table_name: 'auth.users',
        user_column: 'id',
        status: 'error',
        rows_exported: 0,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    } else if (authUser?.user) {
      authBlock = {
        id: authUser.user.id,
        email: authUser.user.email,
        email_confirmed_at: authUser.user.email_confirmed_at,
        phone: authUser.user.phone,
        created_at: authUser.user.created_at,
        updated_at: authUser.user.updated_at,
        last_sign_in_at: authUser.user.last_sign_in_at,
        app_metadata: authUser.user.app_metadata,
        user_metadata: authUser.user.user_metadata,
        // Do NOT include encrypted_password, confirmation_token, recovery_token
      };
      manifest.push({
        table_name: 'auth.users',
        user_column: 'id',
        status: 'success',
        rows_exported: 1,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    manifest.push({
      table_name: 'auth.users',
      user_column: 'id',
      status: 'error',
      rows_exported: 0,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }

  // ---- 2. profile ----
  let profileBlock: Record<string, unknown> = {};
  try {
    const { data: profile, error } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      manifest.push({
        table_name: 'profiles',
        user_column: 'id',
        status: 'error',
        rows_exported: 0,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    } else if (profile) {
      profileBlock = profile as Record<string, unknown>;
      manifest.push({
        table_name: 'profiles',
        user_column: 'id',
        status: 'success',
        rows_exported: 1,
        timestamp: new Date().toISOString(),
      });
    } else {
      manifest.push({
        table_name: 'profiles',
        user_column: 'id',
        status: 'empty',
        rows_exported: 0,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    manifest.push({
      table_name: 'profiles',
      user_column: 'id',
      status: 'error',
      rows_exported: 0,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
  }

  // ---- 3. user-scoped tables ----
  const tablesBlock: Record<string, unknown[] | { error: string }> = {};
  for (const spec of USER_SCOPED_TABLES) {
    try {
      const { data, error } = await admin
        .from(spec.name)
        .select('*')
        .eq(spec.userColumn, userId);

      if (error) {
        tablesBlock[spec.name] = { error: error.message };
        manifest.push({
          table_name: spec.name,
          user_column: spec.userColumn,
          status: 'error',
          rows_exported: 0,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const rows = data ?? [];
      const redactedCols = REDACTED_COLUMNS_BY_TABLE[spec.name];
      const cleaned = redactedCols
        ? rows.map((row: Record<string, unknown>) => {
            const copy = { ...row };
            for (const col of redactedCols) {
              if (col in copy) copy[col] = '[REDACTED]';
            }
            return copy;
          })
        : rows;

      tablesBlock[spec.name] = cleaned;
      manifest.push({
        table_name: spec.name,
        user_column: spec.userColumn,
        status: cleaned.length === 0 ? 'empty' : 'success',
        rows_exported: cleaned.length,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tablesBlock[spec.name] = { error: msg };
      manifest.push({
        table_name: spec.name,
        user_column: spec.userColumn,
        status: 'error',
        rows_exported: 0,
        error: msg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ---- 4. assemble JSON ----
  const dump = {
    _metadata: {
      format_version: '1.0',
      generated_at: new Date().toISOString(),
      export_request_id: exportRequestId,
      user_id: userId,
      tables_covered: USER_SCOPED_TABLES.length,
      includes_auth_users: true,
      includes_profile: true,
      redacted_columns: REDACTED_COLUMNS_BY_TABLE,
      scope_note:
        'Includes tables referencing the user by user_id/author_id/owner_id. ' +
        'Does not yet include project-scoped data transitively (chapters, ' +
        'sources, chapter_regenerations). Contact compliance for a manual ' +
        'request if transitive data is required.',
    },
    auth: authBlock,
    profile: profileBlock,
    tables: tablesBlock,
  };

  const json = JSON.stringify(dump, null, 2);
  const bytes = new TextEncoder().encode(json);
  const filePath = `${userId}/${exportRequestId}.json`;

  // ---- 5. upload to bucket ----
  const { error: uploadErr } = await admin.storage
    .from('compliance-exports')
    .upload(filePath, bytes, {
      contentType: 'application/json',
      upsert: true, // rewriting OK if admin re-triggers fulfilment after a failure
    });

  if (uploadErr) {
    return {
      success: false,
      file_path: filePath,
      file_size_bytes: bytes.byteLength,
      manifest,
      signed_url: '',
      signed_url_expires_at: '',
      error: `storage_upload_failed: ${uploadErr.message}`,
    };
  }

  // ---- 6. signed URL valid for 7 days ----
  const sevenDaysInSeconds = 7 * 24 * 60 * 60;
  const { data: signedData, error: signErr } = await admin.storage
    .from('compliance-exports')
    .createSignedUrl(filePath, sevenDaysInSeconds);

  if (signErr || !signedData) {
    return {
      success: false,
      file_path: filePath,
      file_size_bytes: bytes.byteLength,
      manifest,
      signed_url: '',
      signed_url_expires_at: '',
      error: `signed_url_failed: ${signErr?.message ?? 'unknown'}`,
    };
  }

  return {
    success: true,
    file_path: filePath,
    file_size_bytes: bytes.byteLength,
    manifest,
    signed_url: signedData.signedUrl,
    signed_url_expires_at: new Date(Date.now() + sevenDaysInSeconds * 1000).toISOString(),
  };
}
