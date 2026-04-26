import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { CODE_REGEX, getHmacSecret, verifySignature } from '@/lib/certificates/code';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface VerifyPageProps {
  params: Promise<{ code: string }>;
}

interface VerificationResult {
  status: 'valid' | 'revoked' | 'invalid' | 'not_found';
  code: string;
  display_name?: string;
  issued_at?: string;
  revoked_at?: string;
  revoke_reason?: string;
}

async function verify(code: string): Promise<VerificationResult> {
  if (!CODE_REGEX.test(code)) {
    return { status: 'invalid', code };
  }

  const admin = createServiceClient();
  const { data: cert } = await admin
    .from('guild_certificates')
    .select('guildmember_id, code, hmac_signature, issued_at, revoked_at, revoke_reason')
    .eq('code', code)
    .maybeSingle();

  if (!cert) return { status: 'not_found', code };

  // Verify HMAC binds the stored code+member+timestamp
  let secret: string;
  try {
    secret = getHmacSecret();
  } catch {
    // Server misconfigured — treat as invalid for safety
    return { status: 'invalid', code };
  }
  const ok = verifySignature(cert.guildmember_id, cert.code, cert.issued_at, cert.hmac_signature, secret);
  if (!ok) return { status: 'invalid', code };

  // Fetch member display name
  const { data: member } = await admin
    .from('guild_members')
    .select('display_name')
    .eq('id', cert.guildmember_id)
    .maybeSingle();

  if (cert.revoked_at) {
    return {
      status: 'revoked',
      code,
      display_name: member?.display_name ?? '—',
      issued_at: cert.issued_at,
      revoked_at: cert.revoked_at,
      revoke_reason: cert.revoke_reason ?? undefined,
    };
  }

  return {
    status: 'valid',
    code,
    display_name: member?.display_name ?? '—',
    issued_at: cert.issued_at,
  };
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function VerifyPage({ params }: VerifyPageProps) {
  const { code } = await params;
  const upperCode = (code || '').toUpperCase();
  const result = await verify(upperCode);

  if (result.status === 'invalid' || result.status === 'not_found') {
    return <FailureView code={upperCode} status={result.status} />;
  }

  return <SuccessView result={result} />;
}

function StatusBadge({ status }: { status: VerificationResult['status'] }) {
  const styles: Record<VerificationResult['status'], { bg: string; fg: string; label: string }> = {
    valid: { bg: '#E1F5EE', fg: '#0F6E56', label: 'Valid' },
    revoked: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Revoked' },
    invalid: { bg: '#FCEBEB', fg: '#A32D2D', label: 'Invalid' },
    not_found: { bg: '#F1EFE8', fg: '#444441', label: 'Not found' },
  };
  const s = styles[status];
  return (
    <span style={{ background: s.bg, color: s.fg, padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>
      {s.label}
    </span>
  );
}

function SuccessView({ result }: { result: VerificationResult }) {
  const isRevoked = result.status === 'revoked';
  return (
    <main style={{ minHeight: '100vh', background: '#FAEEDA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#fff', maxWidth: 520, width: '100%', borderRadius: 12, padding: '40px 36px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ fontSize: 11, letterSpacing: 6, textTransform: 'uppercase', color: '#854F0B', fontWeight: 600 }}>Penworth</span>
          <span style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.08)' }} />
          <StatusBadge status={result.status} />
        </div>

        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 500, color: '#0C111E', letterSpacing: -0.2 }}>
          {isRevoked ? 'Certificate revoked' : 'Certificate verified'}
        </h1>
        <p style={{ margin: '0 0 32px', color: '#5F5E5A', fontSize: 14, lineHeight: 1.6 }}>
          {isRevoked
            ? 'This Penworth Guild Foundations certificate is no longer valid.'
            : 'This is a valid Penworth Guild Foundations certificate, issued by Penworth and recorded on our verification system.'}
        </p>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 14, columnGap: 24, fontSize: 14 }}>
          <dt style={{ color: '#5F5E5A' }}>Holder</dt>
          <dd style={{ margin: 0, color: '#0C111E', fontWeight: 500 }}>{result.display_name}</dd>
          <dt style={{ color: '#5F5E5A' }}>Issued</dt>
          <dd style={{ margin: 0, color: '#0C111E' }}>{formatDate(result.issued_at)}</dd>
          <dt style={{ color: '#5F5E5A' }}>Programme</dt>
          <dd style={{ margin: 0, color: '#0C111E' }}>Guild Foundations</dd>
          <dt style={{ color: '#5F5E5A' }}>Certificate ID</dt>
          <dd style={{ margin: 0, color: '#0C111E', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>{result.code}</dd>
          {isRevoked && (
            <>
              <dt style={{ color: '#5F5E5A' }}>Revoked</dt>
              <dd style={{ margin: 0, color: '#A32D2D' }}>{formatDate(result.revoked_at)}</dd>
              {result.revoke_reason && (
                <>
                  <dt style={{ color: '#5F5E5A' }}>Reason</dt>
                  <dd style={{ margin: 0, color: '#0C111E' }}>{result.revoke_reason}</dd>
                </>
              )}
            </>
          )}
        </dl>

        <p style={{ marginTop: 32, paddingTop: 18, borderTop: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#888780', lineHeight: 1.6 }}>
          Penworth records the holder, issuance, and signature for every Guildmember certificate. The presence of this page does not imply any further claim about the holder beyond completion of the Foundations programme.
        </p>
      </div>
    </main>
  );
}

function FailureView({ code, status }: { code: string; status: 'invalid' | 'not_found' }) {
  return (
    <main style={{ minHeight: '100vh', background: '#FAEEDA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ background: '#fff', maxWidth: 520, width: '100%', borderRadius: 12, padding: '40px 36px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <span style={{ fontSize: 11, letterSpacing: 6, textTransform: 'uppercase', color: '#854F0B', fontWeight: 600 }}>Penworth</span>
          <span style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.08)' }} />
          <StatusBadge status={status} />
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 500, color: '#0C111E', letterSpacing: -0.2 }}>
          {status === 'invalid' ? 'Code not in valid format' : 'No certificate found'}
        </h1>
        <p style={{ margin: '0 0 24px', color: '#5F5E5A', fontSize: 14, lineHeight: 1.6 }}>
          {status === 'invalid'
            ? 'Penworth Guild certificate codes follow the format PWG-XXXX-XXXX. The code you entered does not match.'
            : 'No Penworth Guild Foundations certificate exists with this identifier in our records.'}
        </p>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 14, columnGap: 24, fontSize: 14 }}>
          <dt style={{ color: '#5F5E5A' }}>Code provided</dt>
          <dd style={{ margin: 0, color: '#0C111E', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>{code || '—'}</dd>
        </dl>
      </div>
    </main>
  );
}
