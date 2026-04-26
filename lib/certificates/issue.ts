/**
 * Penworth Guild Foundations certificate issuance — shared logic.
 *
 * Used by both:
 *   - POST /api/guild/academy/certificate (member-triggered idempotent issue)
 *   - lib/academy/activation.ts            (server-triggered on 3rd quiz pass)
 *
 * Design: idempotent. If a cert already exists for the member, the existing
 * record is returned with no DB writes. Otherwise the full flow runs:
 *   gate check → code gen → HMAC → PDF build → Storage upload → row insert.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateCode, signCode, getHmacSecret } from '@/lib/certificates/code';
import { buildCertificatePDF } from '@/lib/certificates/generate';

const STORAGE_BUCKET = 'guild-academy';
const VERIFY_BASE_URL = process.env.NEXT_PUBLIC_VERIFY_BASE_URL || 'https://penworth.ai/verify';

export interface IssueResult {
  already_issued: boolean;
  code: string;
  issued_at: string;
  pdf_storage_path: string | null;
  verify_url: string;
  /** Set only on the issuing call (not on idempotent re-fetch). */
  module_ids?: string[];
}

export interface IssueErrorIneligible {
  error: 'ineligible';
  passed: number;
  required: number;
}

export interface IssueErrorNoDisplayName {
  error: 'no_display_name';
}

export type IssueOutcome = IssueResult | IssueErrorIneligible | IssueErrorNoDisplayName;

/**
 * Issue (or re-fetch) the Guild Foundations certificate for a member.
 *
 * Returns either the issued certificate or a structured error indicating
 * why the member isn't eligible. Throws only on infrastructure errors
 * (storage upload failure, DB insert failure).
 */
export async function issueCertificateForMember(
  memberId: string,
  admin: SupabaseClient,
): Promise<IssueOutcome> {
  // Idempotent re-fetch
  const { data: existing } = await admin
    .from('guild_certificates')
    .select('code, issued_at, pdf_storage_path')
    .eq('guildmember_id', memberId)
    .maybeSingle();
  if (existing) {
    return {
      already_issued: true,
      code: existing.code,
      issued_at: existing.issued_at,
      pdf_storage_path: existing.pdf_storage_path,
      verify_url: `${VERIFY_BASE_URL}/${existing.code}`,
    };
  }

  // Member must have a display_name
  const { data: member } = await admin
    .from('guild_members')
    .select('id, display_name')
    .eq('id', memberId)
    .maybeSingle();
  if (!member?.display_name) {
    return { error: 'no_display_name' };
  }

  // Gate: all 3 mandatory courses must be passed
  const { data: mandatoryModules } = await admin
    .from('guild_academy_modules')
    .select('id')
    .eq('category', 'mandatory');
  const moduleIds = (mandatoryModules ?? []).map((m: { id: string }) => m.id);
  if (moduleIds.length === 0) {
    return { error: 'ineligible', passed: 0, required: 0 };
  }

  const { data: passed } = await admin
    .from('guild_academy_progress')
    .select('module_id')
    .eq('guildmember_id', memberId)
    .eq('quiz_passed', true)
    .in('module_id', moduleIds);
  const passedCount = (passed ?? []).length;
  if (passedCount < moduleIds.length) {
    return { error: 'ineligible', passed: passedCount, required: moduleIds.length };
  }

  // Generate, sign, build, upload, insert
  const issuedAtIso = new Date().toISOString();
  const code = generateCode();
  const hmac = signCode(memberId, code, issuedAtIso, getHmacSecret());
  const verifyUrl = `${VERIFY_BASE_URL}/${code}`;

  const pdfBytes = await buildCertificatePDF({
    displayName: member.display_name,
    issuedAtIso,
    code,
    verifyUrl,
  });

  const storagePath = `certificates/${memberId}.pdf`;
  const { error: upErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`Failed to upload certificate PDF: ${upErr.message}`);

  const { error: insErr } = await admin.from('guild_certificates').insert({
    guildmember_id: memberId,
    code,
    hmac_signature: hmac,
    issued_at: issuedAtIso,
    pdf_storage_path: storagePath,
    course_module_ids: moduleIds,
  });
  if (insErr) throw new Error(`Failed to record certificate: ${insErr.message}`);

  // Stamp academy_completed_at if not already set
  await admin
    .from('guild_members')
    .update({ academy_completed_at: issuedAtIso })
    .eq('id', memberId)
    .is('academy_completed_at', null);

  return {
    already_issued: false,
    code,
    issued_at: issuedAtIso,
    pdf_storage_path: storagePath,
    verify_url: verifyUrl,
    module_ids: moduleIds,
  };
}
