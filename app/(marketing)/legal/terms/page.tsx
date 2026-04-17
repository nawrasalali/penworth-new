import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

export const metadata = {
  title: 'Terms of Service — Penworth',
};

export default function TermsPage() {
  const doc = LEGAL_DOCUMENTS.terms;
  return (
    <LegalDocumentLayout
      title={doc.title}
      version={doc.version}
      effectiveDate={doc.effectiveDate}
    >
      <h2>1. Agreement</h2>
      <p>
        These Terms of Service govern your use of Penworth (the &ldquo;Service&rdquo;),
        operated by A.C.N. 675 668 710 PTY LTD (&ldquo;Penworth&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
        By creating an account or using the Service, you agree to be bound by these
        Terms.
      </p>

      <h2>2. The Service</h2>
      <p>
        Penworth is an AI-assisted writing and publishing platform. You describe a
        document; our AI interviews you, generates a manuscript, produces a cover,
        and can publish the result to supported marketplaces on your behalf.
      </p>

      <h2>3. Your Content &amp; Ownership</h2>
      <p>
        You own the documents you create using the Service. You grant Penworth a
        limited licence to store, process, and display your content solely for the
        purpose of providing the Service to you. We do not claim authorship of, and
        will not resell, your content.
      </p>

      <h2>4. AI Output</h2>
      <p>
        AI-generated text may contain inaccuracies, hallucinations, or material
        resembling other works. You are responsible for reviewing every document
        before publishing it and for ensuring it complies with third-party
        platform policies and applicable law.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>
        Your use of the Service is subject to our{' '}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>. Violation may
        result in suspension or termination without refund.
      </p>

      <h2>6. Credits &amp; Billing</h2>
      <p>
        Paid plans and credit packs are billed via Stripe in USD. Credits granted
        under the Free plan expire monthly; credits purchased as packs do not
        expire. Refunds are discretionary and reviewed case-by-case within 14 days
        of purchase.
      </p>

      <h2>7. Publishing Automation</h2>
      <p>
        When you connect a third-party publishing platform, you authorise Penworth
        to submit your manuscript on your behalf using the credentials you provide.
        You remain responsible for your account standing on each platform.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may close your account at any time. We may suspend or terminate access
        for breach of these Terms, the Acceptable Use Policy, or legal obligations.
        On termination, your exported files remain yours.
      </p>

      <h2>9. Limitation of Liability</h2>
      <p>
        To the extent permitted by law, Penworth&rsquo;s aggregate liability under
        these Terms is limited to the fees you paid in the 12 months preceding the
        claim. We are not liable for indirect, consequential, or lost-profit
        damages.
      </p>

      <h2>10. Governing Law</h2>
      <p>
        These Terms are governed by the laws of South Australia, Australia.
        Disputes are resolved in the courts of Adelaide.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these Terms. Material changes will be notified by email or
        in-product at least 30 days before taking effect.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions? Email{' '}
        <a href="mailto:support@penworth.ai">support@penworth.ai</a>.
      </p>
    </LegalDocumentLayout>
  );
}
