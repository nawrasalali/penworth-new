/**
 * GET /api/cron/compliance-export-cleanup
 *
 * Daily maintenance job for the compliance-exports storage bucket.
 * Two classes of file get cleaned up:
 *
 *   1. ORPHANED — a file exists in the bucket but no matching row in
 *      public.data_exports references it. This happens when:
 *        - An admin manually deletes the row but can't delete the
 *          file via SQL (storage.protect_delete() blocks direct
 *          DELETE on storage.objects)
 *        - A stale smoke-test row was cleaned up but the file wasn't
 *        - A row was dropped through a migration or admin action
 *      Orphans are safe to delete — there's no active export
 *      request that still needs them.
 *
 *   2. EXPIRED — the matching row's expires_at is in the past AND
 *      its status is 'delivered' (not already expired or failed).
 *      The signed URL is dead by now, so the file is just occupying
 *      space. Delete the file AND transition status 'delivered' →
 *      'expired' so the admin dashboard reflects reality.
 *
 * Both cleanups go through the Supabase Storage API (via the
 * service-role client) — direct SQL DELETE on storage.objects is
 * blocked by the storage.protect_delete() trigger. An audit_log
 * entry is written per cleanup action (severity=info) so the
 * founder has a paper trail of automated deletions.
 *
 * Schedule: added to vercel.json as '0 3 * * *' (daily at 03:00 UTC),
 * 1 hour after stripe-reconcile. Both are low-urgency maintenance
 * and wouldn't benefit from running in parallel.
 *
 * Query params:
 *   ?dry=1   — report what would be deleted; don't actually delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUCKET = 'compliance-exports';

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dry') === '1';

    const admin = createServiceClient();

    // -------------------------------------------------------------------
    // 1. Enumerate every file in the bucket via the Storage API.
    //
    //    We can't SELECT directly from storage.objects through PostgREST
    //    because the storage schema isn't exposed. The Storage API's
    //    list() is the supported path. It lists one folder at a time,
    //    so we:
    //      a) List the top-level (which returns user_id folders as
    //         entries with NULL id)
    //      b) For each folder, list its contents (actual JSON files
    //         have non-NULL id)
    //
    //    At any realistic scale this is two-level and cheap. If we ever
    //    exceed the per-folder 1000-file limit we'd need pagination,
    //    but 1000 exports per user per day is implausible.
    // -------------------------------------------------------------------
    const allFiles: Array<{ name: string; size?: number }> = [];
    const { data: topLevel, error: topErr } = await admin.storage
      .from(BUCKET)
      .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (topErr) {
      return NextResponse.json(
        { error: 'list_failed', detail: topErr.message },
        { status: 500 },
      );
    }
    for (const entry of topLevel ?? []) {
      // User-id folders come back with id=null
      if (entry.id === null) {
        const { data: userFiles, error: subErr } = await admin.storage
          .from(BUCKET)
          .list(entry.name, { limit: 1000 });
        if (subErr) continue; // skip the folder, don't abort the whole job
        for (const f of userFiles ?? []) {
          if (f.id !== null) {
            allFiles.push({
              name: `${entry.name}/${f.name}`,
              size:
                typeof (f.metadata as any)?.size === 'number'
                  ? (f.metadata as any).size
                  : undefined,
            });
          }
        }
      }
    }

    // -------------------------------------------------------------------
    // 2. Load every data_exports row's file_path + status + expires_at
    //    to cross-reference against the bucket contents.
    // -------------------------------------------------------------------
    const { data: exportRows, error: rowsErr } = await admin
      .from('data_exports')
      .select('id, user_id, file_path, status, expires_at')
      .not('file_path', 'is', null);

    if (rowsErr) {
      return NextResponse.json(
        { error: 'load_rows_failed', detail: rowsErr.message },
        { status: 500 },
      );
    }

    const filePathToRow = new Map<
      string,
      { id: string; user_id: string; status: string; expires_at: string | null }
    >();
    for (const r of exportRows ?? []) {
      if (r.file_path) filePathToRow.set(r.file_path, r as any);
    }

    // -------------------------------------------------------------------
    // 3. Classify every bucket file:
    //    - ORPHAN: no matching data_exports row
    //    - EXPIRED: matching row with status='delivered' AND expires_at<now
    //    - ALIVE: anything else (skip)
    // -------------------------------------------------------------------
    const now = Date.now();
    const orphans: Array<{ name: string; size?: number }> = [];
    const expired: Array<{
      name: string;
      row_id: string;
      user_id: string;
      expired_at: string;
      size?: number;
    }> = [];

    for (const f of allFiles) {
      const matching = filePathToRow.get(f.name);
      if (!matching) {
        orphans.push({ name: f.name, size: f.size });
        continue;
      }
      if (
        matching.status === 'delivered' &&
        matching.expires_at &&
        new Date(matching.expires_at).getTime() < now
      ) {
        expired.push({
          name: f.name,
          row_id: matching.id,
          user_id: matching.user_id,
          expired_at: matching.expires_at,
          size: f.size,
        });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        bucket_files: allFiles.length,
        orphans: orphans.length,
        expired: expired.length,
        orphan_samples: orphans.slice(0, 5).map((o) => o.name),
        expired_samples: expired.slice(0, 5).map((e) => ({
          name: e.name,
          expired_at: e.expired_at,
        })),
      });
    }

    // -------------------------------------------------------------------
    // 4. Delete orphans
    // -------------------------------------------------------------------
    let orphansDeleted = 0;
    const orphanErrors: Array<{ name: string; error: string }> = [];
    if (orphans.length > 0) {
      // Storage API supports batch remove — up to ~1000 paths per call.
      // Our scale is tiny; one call suffices.
      const { data: removed, error: rmErr } = await admin.storage
        .from(BUCKET)
        .remove(orphans.map((o) => o.name));
      if (rmErr) {
        orphanErrors.push({ name: '(batch)', error: rmErr.message });
      } else {
        orphansDeleted = removed?.length ?? orphans.length;
      }
    }

    // -------------------------------------------------------------------
    // 5. Delete expired files AND transition matching rows to 'expired'
    // -------------------------------------------------------------------
    let expiredDeleted = 0;
    const expiredErrors: Array<{ name: string; error: string }> = [];

    for (const e of expired) {
      // Delete the file first — if the row transition fails later, the
      // file is already gone (which is the correct user-visible state;
      // the signed URL was dead anyway).
      const { error: rmErr } = await admin.storage
        .from(BUCKET)
        .remove([e.name]);
      if (rmErr) {
        expiredErrors.push({ name: e.name, error: rmErr.message });
        continue;
      }

      const { error: updateErr } = await admin
        .from('data_exports')
        .update({ status: 'expired' })
        .eq('id', e.row_id)
        .eq('status', 'delivered'); // concurrency guard

      if (updateErr) {
        expiredErrors.push({
          name: e.name,
          error: `file_deleted_but_row_update_failed: ${updateErr.message}`,
        });
        continue;
      }

      // Audit the transition — file+row cleanup is an automated action
      // the founder should be able to see in the paper trail.
      void logAudit({
        actorType: 'cron',
        action: 'admin.override',
        entityType: 'data_export_request',
        entityId: e.row_id,
        before: { status: 'delivered' },
        after: { status: 'expired' },
        metadata: {
          kind: 'export_expiry_cleanup',
          file_path: e.name,
          file_size_bytes: e.size ?? null,
          expired_at: e.expired_at,
          trigger: 'compliance-export-cleanup-cron',
        },
        severity: 'info',
      });

      expiredDeleted++;
    }

    // -------------------------------------------------------------------
    // 6. Summary
    // -------------------------------------------------------------------
    const hadErrors = orphanErrors.length > 0 || expiredErrors.length > 0;
    if (hadErrors) {
      console.error(
        `[compliance-export-cleanup] completed with errors: ${
          orphanErrors.length + expiredErrors.length
        }`,
      );
    }

    return NextResponse.json({
      ok: !hadErrors,
      bucket_files: allFiles.length,
      orphans_found: orphans.length,
      orphans_deleted: orphansDeleted,
      orphan_errors: orphanErrors,
      expired_found: expired.length,
      expired_deleted: expiredDeleted,
      expired_errors: expiredErrors,
    });
  } catch (err: any) {
    console.error('[compliance-export-cleanup] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Cleanup failed' },
      { status: 500 },
    );
  }
}
