import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

export const metadata = {
  title: 'Privacy Policy — Penworth',
};

export default function PrivacyPage() {
  const doc = LEGAL_DOCUMENTS.privacy;
  return (
    <LegalDocumentLayout
      title={doc.title}
      version={doc.version}
      effectiveDate={doc.effectiveDate}
    >
      <h2>1. Who We Are</h2>
      <p>
        Penworth (A.C.N. 675 668 710 PTY LTD) is the data controller for
        information collected through penworth.ai and its subdomains.
      </p>

      <h2>2. Data We Collect</h2>
      <ul>
        <li>
          <strong>Account data.</strong> Email address, name, password hash,
          language preference, country (for tax and compliance).
        </li>
        <li>
          <strong>Content.</strong> The documents you create, including
          interview answers, outlines, chapters, and covers.
        </li>
        <li>
          <strong>Billing.</strong> Handled by Stripe. We store a Stripe customer
          ID and subscription status; we do not store card numbers.
        </li>
        <li>
          <strong>Publishing credentials.</strong> When you connect third-party
          platforms (e.g. Kobo, Google Play Books), we store encrypted OAuth
          tokens or API keys. Credentials are decrypted only at publish time.
        </li>
        <li>
          <strong>Usage data.</strong> Pages viewed, actions taken, feature
          usage. Used to improve the Service and diagnose issues.
        </li>
        <li>
          <strong>Device data.</strong> IP address, user agent, browser language.
        </li>
      </ul>

      <h2>3. How We Use Data</h2>
      <p>
        To provide the Service, process payments, operate publishing automation,
        send transactional email, detect abuse, and comply with legal
        obligations.
      </p>

      <h2>4. Third-Party Processors</h2>
      <p>
        We share data with vetted processors under Data Processing Agreements:
      </p>
      <ul>
        <li>Supabase (database + authentication, hosted in the EU)</li>
        <li>Vercel (application hosting + edge network)</li>
        <li>Stripe (payment processing)</li>
        <li>Anthropic (AI inference)</li>
        <li>ElevenLabs (audiobook narration)</li>
        <li>Ideogram (cover generation)</li>
        <li>Browserbase (publishing automation)</li>
        <li>Resend (transactional email)</li>
        <li>
          Connected publishing platforms (only when you explicitly publish to
          them)
        </li>
      </ul>

      <h2>5. International Transfers</h2>
      <p>
        Your data is processed in jurisdictions including Australia, the EU, and
        the United States. Transfers are governed by Standard Contractual
        Clauses where required.
      </p>

      <h2>6. Your Rights</h2>
      <p>
        You can access, correct, export, or delete your data by emailing{' '}
        <a href="mailto:support@penworth.ai">support@penworth.ai</a>. We respond
        within 30 days (or as required by your local law, whichever is shorter).
      </p>

      <h2>7. Retention</h2>
      <p>
        Account and content data is retained while your account is active.
        Financial records are retained for 7 years under Australian law. Consent
        records are append-only and retained for 7 years.
      </p>

      <h2>8. Security</h2>
      <p>
        Data is encrypted in transit (TLS) and at rest. Publishing credentials
        are additionally encrypted with AES-256-GCM using per-user keys.
        Row-Level Security at the database layer prevents one user from
        reading another user&rsquo;s content.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to children under 16. We do not knowingly
        collect data from them.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy enquiries: <a href="mailto:support@penworth.ai">support@penworth.ai</a>.
      </p>
    </LegalDocumentLayout>
  );
}
