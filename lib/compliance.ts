/**
 * Server-side helpers for GDPR/PDPA data-subject-rights infrastructure.
 *
 * Two lifecycles are modelled here:
 *
 *   1. Right to Erasure (Article 17 GDPR, equivalents in 10+ other
 *      jurisdictions) → data_deletion_requests
 *   2. Right to Data Portability (Article 20 GDPR) → data_exports
 *
 * This module exposes creation helpers for both (user-facing and
 * admin-facing), plus deadline utilities and type definitions. The
 * actual FULFILMENT of requests (running the deletes, building the
 * JSON dump) is a separate admin-driven workflow — see
 * /app/api/admin/compliance/ for those endpoints.
 *
 * JURISDICTION INFERENCE
 * ----------------------
 * The jurisdiction column is used by the Compliance Agent to surface
 * which local-law requirements apply to each request. We infer it
 * from the user's preferred_language (when set) plus the country
 * derived from Vercel's x-vercel-ip-country request header. If both
 * are absent, leave null — the admin will set it during processing.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { logAudit } from '@/lib/audit';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type DeletionStatus =
  | 'received'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'failed';

export type DeletionSource = 'user' | 'regulator' | 'admin' | 'automated';

export type ExportStatus =
  | 'received'
  | 'processing'
  | 'delivered'
  | 'expired'
  | 'failed';

export type ExportFormat = 'json' | 'csv' | 'zip';

export interface DeletionRequest {
  id: string;
  user_id: string;
  user_email: string;
  requested_at: string;
  statutory_deadline: string;
  request_source: DeletionSource;
  jurisdiction: string | null;
  status: DeletionStatus;
  processing_started_at: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  processed_by: string | null;
  fulfillment_notes: string | null;
  deletion_manifest: unknown[];
  created_at: string;
  updated_at: string;
}

export interface ExportRequest {
  id: string;
  user_id: string;
  user_email: string;
  requested_at: string;
  statutory_deadline: string;
  format: ExportFormat;
  status: ExportStatus;
  processing_started_at: string | null;
  delivered_at: string | null;
  expires_at: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  processed_by: string | null;
  failure_reason: string | null;
  export_manifest: unknown[];
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------------
// Creation helpers — called from API route handlers
// ----------------------------------------------------------------------------

export interface CreateDeletionRequestInput {
  userId: string;
  userEmail: string;
  source: DeletionSource;
  jurisdiction?: string | null;
  /** IP + user-agent only captured when source='user' */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a data_deletion_requests row and writes a paired audit_log
 * entry. Returns the inserted row on success. If the insert fails,
 * returns { error }.
 *
 * Called from:
 *   - /api/account/delete-request    (user-initiated, source='user')
 *   - /admin/compliance/deletions    (admin-initiated, source='admin')
 *
 * Does NOT perform any deletions itself. The row sits in status
 * 'received' until an admin transitions it through processing.
 */
export async function createDeletionRequest(
  input: CreateDeletionRequestInput,
): Promise<
  | { ok: true; request: DeletionRequest }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('data_deletion_requests')
      .insert({
        user_id: input.userId,
        user_email: input.userEmail,
        request_source: input.source,
        jurisdiction: input.jurisdiction ?? null,
        // statutory_deadline is set by the BEFORE INSERT trigger
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[compliance] createDeletionRequest failed:', error);
      return { ok: false, error: error?.message ?? 'insert_failed' };
    }

    const request = data as DeletionRequest;

    // Always audit. Never throw.
    void logAudit({
      actorType: input.source === 'user' ? 'user' : 'admin',
      actorUserId: input.userId,
      action: 'admin.override',
      entityType: 'data_deletion_request',
      entityId: request.id,
      after: {
        status: request.status,
        request_source: request.request_source,
        statutory_deadline: request.statutory_deadline,
        jurisdiction: request.jurisdiction,
      },
      metadata: {
        kind: 'create_data_deletion_request',
        user_email: request.user_email,
      },
      severity: 'warning', // any deletion request is worth a human glance
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return { ok: true, request };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[compliance] createDeletionRequest crashed:', message);
    return { ok: false, error: message };
  }
}

export interface CreateExportRequestInput {
  userId: string;
  userEmail: string;
  format?: ExportFormat;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function createExportRequest(
  input: CreateExportRequestInput,
): Promise<
  | { ok: true; request: ExportRequest }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('data_exports')
      .insert({
        user_id: input.userId,
        user_email: input.userEmail,
        format: input.format ?? 'json',
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[compliance] createExportRequest failed:', error);
      return { ok: false, error: error?.message ?? 'insert_failed' };
    }

    const request = data as ExportRequest;

    void logAudit({
      actorType: 'user',
      actorUserId: input.userId,
      action: 'admin.override',
      entityType: 'data_export_request',
      entityId: request.id,
      after: {
        status: request.status,
        format: request.format,
        statutory_deadline: request.statutory_deadline,
      },
      metadata: {
        kind: 'create_data_export_request',
        user_email: request.user_email,
      },
      severity: 'info', // exports are lower-risk than deletions
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return { ok: true, request };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[compliance] createExportRequest crashed:', message);
    return { ok: false, error: message };
  }
}

// ----------------------------------------------------------------------------
// Deadline utilities
// ----------------------------------------------------------------------------

/**
 * Returns the number of days remaining until the statutory deadline.
 * Negative numbers mean the deadline has passed (a legal breach).
 */
export function daysUntilDeadline(statutoryDeadlineIso: string): number {
  const deadline = new Date(statutoryDeadlineIso).getTime();
  const now = Date.now();
  return Math.floor((deadline - now) / (24 * 60 * 60 * 1000));
}

export function isDeadlineApproaching(statutoryDeadlineIso: string, thresholdDays: number = 5): boolean {
  const d = daysUntilDeadline(statutoryDeadlineIso);
  return d <= thresholdDays && d >= 0;
}

export function isDeadlineBreached(statutoryDeadlineIso: string): boolean {
  return daysUntilDeadline(statutoryDeadlineIso) < 0;
}

// ----------------------------------------------------------------------------
// Jurisdiction inference
// ----------------------------------------------------------------------------

const COUNTRY_TO_JURISDICTION: Record<string, string> = {
  // EU/UK/EEA — GDPR
  DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', NL: 'EU', BE: 'EU', PL: 'EU',
  SE: 'EU', DK: 'EU', FI: 'EU', AT: 'EU', IE: 'EU', PT: 'EU', GR: 'EU',
  CZ: 'EU', HU: 'EU', RO: 'EU', BG: 'EU', HR: 'EU', SK: 'EU', SI: 'EU',
  LV: 'EU', LT: 'EU', EE: 'EU', LU: 'EU', MT: 'EU', CY: 'EU',
  NO: 'EU', IS: 'EU', LI: 'EU',
  GB: 'UK',
  // Penworth target markets with specific regimes
  AU: 'AU', NZ: 'AU',
  IN: 'IN',
  TH: 'TH',
  VN: 'VN',
  PH: 'PH',
  ID: 'ID',
  BD: 'BD',
  NG: 'NG',
  ZA: 'ZA',
  EG: 'EG',
  SA: 'SA',
  AE: 'AE',
  MA: 'MA',
  PK: 'PK',
  // Default
  US: 'US', CA: 'CA',
};

export function inferJurisdictionFromCountryCode(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return COUNTRY_TO_JURISDICTION[countryCode.toUpperCase()] ?? null;
}

/**
 * Convenience: infer jurisdiction from a Next.js Request object using
 * Vercel's x-vercel-ip-country header.
 */
export function inferJurisdictionFromRequest(req: Request): string | null {
  const cc = req.headers.get('x-vercel-ip-country');
  return inferJurisdictionFromCountryCode(cc);
}
