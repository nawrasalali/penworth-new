import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateCode, signCode, getHmacSecret } from '@/lib/certificates/code';
import { buildCertificatePDF } from '@/lib/certificates/generate';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'guild-academy';
const VERIFY_BASE_URL = process.env.NEXT_PUBLIC_VERIFY_BASE_URL || 'https://penworth.ai/verify';

/**
 * POST /api/guild/academy/certificate
 *
 * Idempotent. If the calling member already has a certificate, returns the
 * existing record and a signed download URL. Otherwise:
 *   1. Verifies all 3 mandatory courses are passed (quiz_passed=true)
 *   2. Generates PWG-XXXX-XXXX code + HMAC signature
 *   3. Builds PDF, uploads to guild-academy/certificates/{member_id}.pdf
 *   4. Inserts guild_certificates row
 *   5. Returns { code, issued_at, pdf_url, verify_url }
 *
 * The activation flow (referral code, agent unlock, email) is wired separately
 * (CEO-155) and calls this endpoint internally.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = createServiceClient();

    const { data: member } = await admin
      .from('guild_members')
      .select('id, display_name, status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });
    if (!member.display_name) {
      return NextResponse.json({ error: 'display_name not set on Guildmember profile' }, { status: 400 });
    }

    // Idempotency — if a cert already exists, return it
    const { data: existing } = await admin
      .from('guild_certificates')
      .select('id, code, issued_at, pdf_storage_path, revoked_at, course_module_ids')
      .eq('guildmember_id', member.id)
      .maybeSingle();

    if (existing) {
      let pdfUrl: string | null = null;
      if (existing.pdf_storage_path) {
        const { data: signed } = await admin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(existing.pdf_storage_path, 60 * 60); // 1h
        pdfUrl = signed?.signedUrl ?? null;
      }
      return NextResponse.json({
        already_issued: true,
        code: existing.code,
        issued_at: existing.issued_at,
        revoked_at: existing.revoked_at,
        pdf_url: pdfUrl,
        verify_url: `${VERIFY_BASE_URL}/${existing.code}`,
      });
    }

    // Gate: all 3 mandatory courses must be passed
    const { data: mandatoryModules } = await admin
      .from('guild_academy_modules')
      .select('id, slug')
      .eq('category', 'mandatory');
    if (!mandatoryModules || mandatoryModules.length === 0) {
      return NextResponse.json({ error: 'No mandatory courses found' }, { status: 500 });
    }
    const moduleIds = mandatoryModules.map((m) => m.id);

    const { data: passed } = await admin
      .from('guild_academy_progress')
      .select('module_id, quiz_passed')
      .eq('guildmember_id', member.id)
      .eq('quiz_passed', true)
      .in('module_id', moduleIds);
    const passedCount = (passed ?? []).length;

    if (passedCount < mandatoryModules.length) {
      return NextResponse.json({
        error: 'Not eligible — all three mandatory courses must be passed',
        passed: passedCount,
        required: mandatoryModules.length,
      }, { status: 403 });
    }

    // Generate code + sign + build PDF
    const issuedAtIso = new Date().toISOString();
    const code = generateCode();
    const secret = getHmacSecret();
    const hmac = signCode(member.id, code, issuedAtIso, secret);
    const verifyUrl = `${VERIFY_BASE_URL}/${code}`;

    const pdfBytes = await buildCertificatePDF({
      displayName: member.display_name,
      issuedAtIso,
      code,
      verifyUrl,
    });

    // Upload to Storage
    const storagePath = `certificates/${member.id}.pdf`;
    const { error: upErr } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.error('[academy/certificate] upload error', upErr);
      return NextResponse.json({ error: 'Failed to upload certificate PDF' }, { status: 500 });
    }

    // Insert cert row (unique on guildmember_id; one cert per member)
    const { error: insErr } = await admin.from('guild_certificates').insert({
      guildmember_id: member.id,
      code,
      hmac_signature: hmac,
      issued_at: issuedAtIso,
      pdf_storage_path: storagePath,
      course_module_ids: moduleIds,
    });
    if (insErr) {
      console.error('[academy/certificate] insert error', insErr);
      return NextResponse.json({ error: 'Failed to record certificate' }, { status: 500 });
    }

    // Stamp academy_completed_at on the member if not already set (idempotency safe)
    await admin
      .from('guild_members')
      .update({ academy_completed_at: issuedAtIso })
      .eq('id', member.id)
      .is('academy_completed_at', null);

    const { data: signed } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      already_issued: false,
      code,
      issued_at: issuedAtIso,
      pdf_url: signed?.signedUrl ?? null,
      verify_url: verifyUrl,
    });
  } catch (e: any) {
    console.error('[academy/certificate] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

/**
 * GET /api/guild/academy/certificate — returns the caller's existing certificate
 * (or 404 if not issued yet). No side effects.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const admin = createServiceClient();
    const { data: member } = await admin
      .from('guild_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Not a Guildmember' }, { status: 403 });

    const { data: cert } = await admin
      .from('guild_certificates')
      .select('code, issued_at, pdf_storage_path, revoked_at')
      .eq('guildmember_id', member.id)
      .maybeSingle();
    if (!cert) return NextResponse.json({ error: 'No certificate issued' }, { status: 404 });

    let pdfUrl: string | null = null;
    if (cert.pdf_storage_path) {
      const { data: signed } = await admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(cert.pdf_storage_path, 60 * 60);
      pdfUrl = signed?.signedUrl ?? null;
    }

    return NextResponse.json({
      code: cert.code,
      issued_at: cert.issued_at,
      revoked_at: cert.revoked_at,
      pdf_url: pdfUrl,
      verify_url: `${VERIFY_BASE_URL}/${cert.code}`,
    });
  } catch (e: any) {
    console.error('[academy/certificate GET] exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
