/**
 * POST /api/account/export-request
 *
 * User-facing endpoint. Files a Right-to-Data-Portability (GDPR
 * Article 20) request. Creates a data_exports row in status
 * 'received'. Admin fulfils the request by generating the JSON dump
 * and emailing a signed URL.
 *
 * Body: { format?: 'json' | 'csv' | 'zip' }   defaults to 'json'
 *
 * Response 201:
 *   {
 *     ok: true,
 *     request_id: uuid,
 *     format: 'json',
 *     statutory_deadline: ISO-8601,
 *     message: "Your data export request has been received..."
 *   }
 *
 * Response 409 if an open request already exists.
 * Response 400 for invalid format.
 * Response 401 if unauthenticated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createExportRequest, type ExportFormat } from '@/lib/compliance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_FORMATS: ExportFormat[] = ['json', 'csv', 'zip'];

export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[account/export-request]', message);
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { format?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body OK — we default to JSON
  }

  const format: ExportFormat =
    VALID_FORMATS.includes(body.format as ExportFormat)
      ? (body.format as ExportFormat)
      : 'json';

  if (body.format && !VALID_FORMATS.includes(body.format as ExportFormat)) {
    return NextResponse.json(
      { error: 'invalid_format', message: `format must be one of: ${VALID_FORMATS.join(', ')}` },
      { status: 400 },
    );
  }

  // Idempotency
  const admin = createServiceClient();
  const { data: existing } = await admin
    .from('data_exports')
    .select('id, status, statutory_deadline')
    .eq('user_id', user.id)
    .in('status', ['received', 'processing'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error: 'request_already_pending',
        existing_request_id: existing.id,
        existing_status: existing.status,
        existing_deadline: existing.statutory_deadline,
        message: 'An export request is already in progress for this account.',
      },
      { status: 409 },
    );
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single();
  const userEmail = profile?.email ?? user.email ?? '';

  const xff = request.headers.get('x-forwarded-for') ?? '';
  const clientIp = xff.split(',')[0].trim() || request.headers.get('x-real-ip') || null;

  const result = await createExportRequest({
    userId: user.id,
    userEmail,
    format,
    ipAddress: clientIp,
    userAgent: request.headers.get('user-agent'),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'failed_to_create_request', message: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      request_id: result.request.id,
      format: result.request.format,
      statutory_deadline: result.request.statutory_deadline,
      message:
        'Your data export request has been received. You will receive an ' +
        'email with a download link within 30 days. The link will be valid ' +
        'for 7 days after delivery.',
    },
    { status: 201 },
  );
}
