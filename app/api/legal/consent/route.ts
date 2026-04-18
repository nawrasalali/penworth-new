import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, type LegalDocumentKey } from '@/lib/legal/documents';

/**
 * POST /api/legal/consent
 *
 * Records consent for one or more legal documents for the authenticated user.
 * Writes append-only rows to consent_records. Captures IP + user-agent from
 * request headers so the audit trail matches what the user's browser reported
 * at the time of acceptance.
 *
 * Body: { documents: ('terms'|'privacy'|'acceptable_use')[] }
 * Response: { ok: true, recorded: LegalDocumentKey[] }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { documents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawDocuments = Array.isArray(body.documents) ? body.documents : [];
  const documents = rawDocuments.filter(
    (d): d is LegalDocumentKey =>
      typeof d === 'string' && LEGAL_DOCUMENT_KEYS.includes(d as LegalDocumentKey),
  );

  if (documents.length === 0) {
    return NextResponse.json(
      { error: 'No valid document keys provided' },
      { status: 400 },
    );
  }

  // Capture request metadata. x-forwarded-for may contain a comma-separated
  // chain of IPs (client, proxy, proxy); the first is the original client.
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent') || null;

  const rows = documents.map((docKey) => ({
    user_id: user.id,
    document_key: docKey,
    document_version: LEGAL_DOCUMENTS[docKey].version,
    ip_address: ip,
    user_agent: userAgent,
  }));

  const { error } = await supabase.from('consent_records').insert(rows);
  if (error) {
    console.error('[legal/consent] insert failed:', error);
    return NextResponse.json(
      { error: 'Failed to record consent' },
      { status: 500 },
    );
  }

  // When the user has accepted the FULL legal pack (all three documents),
  // stamp profiles.consent_accepted_at so the first-login modal stops
  // showing up. This is what makes the modal "only once". We compute
  // acceptance from consent_records rather than trusting the POST body
  // alone — that way partial submissions (somehow) don't satisfy the gate.
  const { data: allRecords } = await supabase
    .from('consent_records')
    .select('document_key')
    .eq('user_id', user.id);

  const acceptedKeys = new Set((allRecords ?? []).map((r) => r.document_key as string));
  const hasFullPack = LEGAL_DOCUMENT_KEYS.every((k) => acceptedKeys.has(k));

  if (hasFullPack) {
    // Build a deterministic version string so the Compliance Agent can
    // later check whether the user's accepted version matches current.
    const version = LEGAL_DOCUMENT_KEYS
      .map((k) => `${k}@${LEGAL_DOCUMENTS[k].version}`)
      .join('|');

    await supabase
      .from('profiles')
      .update({
        consent_accepted_at: new Date().toISOString(),
        consent_accepted_version: version,
      })
      .eq('id', user.id);
  }

  return NextResponse.json({ ok: true, recorded: documents, fullPackAccepted: hasFullPack });
}
