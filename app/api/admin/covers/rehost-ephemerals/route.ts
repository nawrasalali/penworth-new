import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/covers/rehost-ephemerals
 *
 * Internal one-shot backfill for CEO-073: any cover row whose
 * `front_cover_url` or `back_cover_url` still points at
 * `ideogram.ai/api/images/ephemeral/...` gets re-fetched and re-hosted
 * in the public `covers` bucket so it survives Ideogram's ~10-hour
 * URL expiry.
 *
 * Auth: requires header `x-admin-secret: ${ADMIN_INTERNAL_SECRET}`.
 * Idempotent: rows that already have a Supabase storage URL are
 * skipped on subsequent runs.
 *
 * Returns: { scanned, rehosted, skipped, failures: [...] }.
 */
export async function POST(request: NextRequest) {
  // Cheap shared-secret gate. This endpoint touches every author's
  // cover URL, so it MUST NOT be public. Service-role client is used
  // intentionally to bypass RLS — backfilling other users' rows is
  // the entire point.
  const provided = request.headers.get('x-admin-secret') ?? '';
  const expected = process.env.ADMIN_INTERNAL_SECRET ?? '';
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = createServiceClient();

  // Find every session with at least one ephemeral URL
  const { data: rows, error: queryErr } = await admin
    .from('interview_sessions')
    .select('id, user_id, front_cover_url, back_cover_url')
    .or(
      'front_cover_url.like.%ideogram.ai/api/images/ephemeral/%,'
      + 'back_cover_url.like.%ideogram.ai/api/images/ephemeral/%',
    );

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  let scanned = 0;
  let rehosted = 0;
  let skipped = 0;
  const failures: Array<{ session_id: string; cover: string; reason: string }> = [];

  for (const row of rows ?? []) {
    scanned++;
    const updates: Record<string, string> = {};

    for (const cover of ['front', 'back'] as const) {
      const col = `${cover}_cover_url` as 'front_cover_url' | 'back_cover_url';
      const url: string | null = row[col];
      if (!url || !url.includes('ideogram.ai/api/images/ephemeral/')) {
        skipped++;
        continue;
      }

      try {
        const imgResp = await fetch(url);
        if (!imgResp.ok) {
          throw new Error(`fetch HTTP ${imgResp.status} (URL likely already expired)`);
        }
        const contentType = imgResp.headers.get('content-type') || 'image/png';
        const ext = contentType.includes('jpeg') ? 'jpg'
                  : contentType.includes('webp') ? 'webp'
                  : 'png';
        const bytes = await imgResp.arrayBuffer();
        const path = `${row.user_id}/covers/${row.id}-${cover}.${ext}`;

        const { error: uploadErr } = await admin
          .storage
          .from('covers')
          .upload(path, bytes, {
            contentType,
            upsert: true,
            cacheControl: '31536000',
          });

        if (uploadErr) {
          throw new Error(`upload: ${uploadErr.message}`);
        }

        const { data: { publicUrl } } = admin
          .storage
          .from('covers')
          .getPublicUrl(path);

        updates[col] = `${publicUrl}?v=${Date.now()}`;
        rehosted++;
      } catch (err: any) {
        failures.push({
          session_id: row.id,
          cover,
          reason: String(err?.message ?? err).slice(0, 200),
        });
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await admin
        .from('interview_sessions')
        .update(updates)
        .eq('id', row.id);
      if (updErr) {
        failures.push({
          session_id: row.id,
          cover: 'db_update',
          reason: updErr.message.slice(0, 200),
        });
      }
    }
  }

  return NextResponse.json({ scanned, rehosted, skipped, failures });
}
