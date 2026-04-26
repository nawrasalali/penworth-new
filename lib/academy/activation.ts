/**
 * Activation flow for new Guildmembers.
 *
 * Triggered when a member passes the third mandatory Foundations course.
 * Idempotent — safe to call multiple times. The check
 * `guild_members.academy_completed_at IS NULL` is the gate; once it's
 * stamped, repeated calls return early without side effects.
 *
 * Side effects, in order:
 *   1. Issue Foundations certificate (idempotent — see lib/certificates/issue.ts)
 *   2. Stamp academy_completed_at on the member row (done by issuer)
 *   3. Generate referral code if member.referral_code is null
 *   4. Set member.status = 'active' if currently 'probation' or null
 *   5. Insert one guild_agent_context row per Guild agent (7 total)
 *   6. Send activation email via Resend with cert PDF link + referral code
 *
 * Failure-tolerant: if any non-critical step fails (email, agent context),
 * the function logs and continues. Cert + member updates are critical and
 * propagate errors to the caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { GUILD_AGENTS, type GuildAgentName } from '@/lib/guild/agents/registry';
import { issueCertificateForMember, type IssueResult } from '@/lib/certificates/issue';
import { sendGuildAcademyActivationEmail } from '@/lib/email/guild';

const STORAGE_BUCKET = 'guild-academy';

export interface ActivationResult {
  activated: boolean;
  already_activated: boolean;
  member_id: string;
  referral_code: string | null;
  certificate_code: string | null;
  certificate_pdf_signed_url: string | null;
  email_sent: boolean;
  notes: string[];
}

interface MemberRow {
  id: string;
  user_id: string;
  display_name: string | null;
  tier: string | null;
  referral_code: string | null;
  status: string | null;
  academy_completed_at: string | null;
}

/**
 * Build a candidate referral code from the member's display_name.
 * Format: 6 uppercase A-Z chars (padded with X if name too short or has too few letters)
 *         + 2-digit numeric suffix.
 * Example: 'Nawras Alali' → 'NAWRAS47'.
 */
function candidateReferralCode(displayName: string): string {
  const letters = (displayName || '').toUpperCase().replace(/[^A-Z]/g, '');
  const base = (letters + 'XXXXXX').slice(0, 6);
  const suffix = Math.floor(Math.random() * 90 + 10).toString(); // 10-99
  return `${base}${suffix}`;
}

async function generateUniqueReferralCode(
  admin: SupabaseClient,
  memberId: string,
  displayName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = candidateReferralCode(displayName);
    const { data: collision } = await admin
      .from('guild_members')
      .select('id')
      .eq('referral_code', candidate)
      .neq('id', memberId)
      .maybeSingle();
    if (!collision) return candidate;
  }
  // Fallback: append a longer suffix if rare collision storm
  return `${candidateReferralCode(displayName).slice(0, 6)}${Date.now().toString().slice(-4)}`;
}

async function unlockAgentContext(
  admin: SupabaseClient,
  memberId: string,
  notes: string[],
): Promise<void> {
  const agentNames = Object.keys(GUILD_AGENTS) as GuildAgentName[];
  const rows = agentNames.map((name) => ({
    guildmember_id: memberId,
    agent_name: name,
    context: {},
  }));
  const { error } = await admin
    .from('guild_agent_context')
    .upsert(rows, { onConflict: 'guildmember_id,agent_name', ignoreDuplicates: true });
  if (error) {
    notes.push(`agent_context_upsert_failed: ${error.message}`);
    console.error('[activation] guild_agent_context upsert', error);
    return;
  }
  notes.push(`agent_context_unlocked: ${agentNames.join(',')}`);
}

/**
 * Idempotent activation. Caller must already have verified the member exists.
 * Returns details for the caller to surface to the UI.
 */
export async function triggerActivationIfEligible(
  memberId: string,
  admin: SupabaseClient,
): Promise<ActivationResult> {
  const notes: string[] = [];

  // Load member
  const { data: member, error: memberErr } = await admin
    .from('guild_members')
    .select('id, user_id, display_name, tier, referral_code, status, academy_completed_at')
    .eq('id', memberId)
    .maybeSingle<MemberRow>();
  if (memberErr) throw new Error(`Load member: ${memberErr.message}`);
  if (!member) throw new Error(`Member ${memberId} not found`);

  // Already activated — return current state
  if (member.academy_completed_at) {
    let pdfUrl: string | null = null;
    const { data: cert } = await admin
      .from('guild_certificates')
      .select('code, pdf_storage_path')
      .eq('guildmember_id', memberId)
      .maybeSingle();
    if (cert?.pdf_storage_path) {
      const { data: signed } = await admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(cert.pdf_storage_path, 60 * 60);
      pdfUrl = signed?.signedUrl ?? null;
    }
    return {
      activated: false,
      already_activated: true,
      member_id: memberId,
      referral_code: member.referral_code,
      certificate_code: cert?.code ?? null,
      certificate_pdf_signed_url: pdfUrl,
      email_sent: false,
      notes: ['already_activated'],
    };
  }

  // Issue cert (also stamps academy_completed_at)
  const certOutcome = await issueCertificateForMember(memberId, admin);
  if ('error' in certOutcome) {
    if (certOutcome.error === 'ineligible') {
      return {
        activated: false,
        already_activated: false,
        member_id: memberId,
        referral_code: member.referral_code,
        certificate_code: null,
        certificate_pdf_signed_url: null,
        email_sent: false,
        notes: [`ineligible: ${certOutcome.passed}/${certOutcome.required} mandatory courses passed`],
      };
    }
    if (certOutcome.error === 'no_display_name') {
      return {
        activated: false,
        already_activated: false,
        member_id: memberId,
        referral_code: member.referral_code,
        certificate_code: null,
        certificate_pdf_signed_url: null,
        email_sent: false,
        notes: ['display_name_missing — set on profile before activation'],
      };
    }
  }
  const cert = certOutcome as IssueResult;

  // Generate referral code if absent
  let referralCode = member.referral_code;
  if (!referralCode && member.display_name) {
    referralCode = await generateUniqueReferralCode(admin, memberId, member.display_name);
    const { error: refErr } = await admin
      .from('guild_members')
      .update({ referral_code: referralCode })
      .eq('id', memberId)
      .is('referral_code', null);
    if (refErr) {
      notes.push(`referral_code_set_failed: ${refErr.message}`);
      referralCode = member.referral_code; // revert to existing (may be null)
    } else {
      notes.push(`referral_code_issued: ${referralCode}`);
    }
  } else if (referralCode) {
    notes.push(`referral_code_existing: ${referralCode}`);
  }

  // Promote to active if currently null/probation
  if (!member.status || member.status === 'probation') {
    const { error: statusErr } = await admin
      .from('guild_members')
      .update({ status: 'active' })
      .eq('id', memberId);
    if (statusErr) notes.push(`status_update_failed: ${statusErr.message}`);
    else notes.push(`status_set_active`);
  }

  // Unlock all 7 Guild agents
  await unlockAgentContext(admin, memberId, notes);

  // Signed URL for the email + UI
  let pdfSignedUrl: string | null = null;
  if (cert.pdf_storage_path) {
    const { data: signed } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(cert.pdf_storage_path, 60 * 60 * 24 * 7); // 7 days for the email
    pdfSignedUrl = signed?.signedUrl ?? null;
  }

  // Send activation email (best-effort)
  let emailSent = false;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(member.user_id);
    const email = authUser?.user?.email;
    if (email && member.display_name) {
      const result = await sendGuildAcademyActivationEmail({
        email,
        displayName: member.display_name,
        referralCode: referralCode ?? '—',
        certificateCode: cert.code,
        certificatePdfUrl: pdfSignedUrl ?? cert.verify_url,
        verifyUrl: cert.verify_url,
        tier: member.tier ?? 'apprentice',
      });
      emailSent = result.success;
      if (!result.success) notes.push(`email_send_failed`);
      else notes.push(`email_sent`);
    } else {
      notes.push('email_skipped: no auth email or display_name');
    }
  } catch (e) {
    console.error('[activation] email error', e);
    notes.push(`email_exception`);
  }

  return {
    activated: true,
    already_activated: false,
    member_id: memberId,
    referral_code: referralCode,
    certificate_code: cert.code,
    certificate_pdf_signed_url: pdfSignedUrl,
    email_sent: emailSent,
    notes,
  };
}
