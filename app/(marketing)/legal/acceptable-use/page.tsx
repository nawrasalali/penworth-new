import { LegalDocumentLayout } from '@/components/legal/LegalDocumentLayout';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

export const metadata = {
  title: 'Acceptable Use Policy — Penworth',
};

export default function AcceptableUsePage() {
  const doc = LEGAL_DOCUMENTS.acceptable_use;
  return (
    <LegalDocumentLayout
      title={doc.title}
      version={doc.version}
      effectiveDate={doc.effectiveDate}
    >
      <h2>1. Purpose</h2>
      <p>
        This Acceptable Use Policy describes content and conduct that is not
        permitted on Penworth. It applies to every document generated, stored,
        published, or distributed through the Service.
      </p>

      <h2>2. Prohibited Content</h2>
      <p>You must not use the Service to create, store, or distribute:</p>
      <ul>
        <li>Child sexual abuse material or content sexualising minors.</li>
        <li>
          Content that promotes violence, terrorism, genocide, or targeted
          harassment of individuals or groups.
        </li>
        <li>
          Content that facilitates illegal activity, including weapons of mass
          destruction, synthesis of controlled substances, or financial fraud.
        </li>
        <li>
          Material that infringes copyright, trademark, or other intellectual
          property rights of third parties.
        </li>
        <li>
          Non-consensual intimate imagery or content depicting real people in
          sexual contexts without their permission.
        </li>
        <li>
          Malware, phishing content, or material designed to deceive readers
          into disclosing credentials or financial information.
        </li>
        <li>
          Misinformation presented as fact on matters of public health,
          election integrity, or emergency response.
        </li>
        <li>
          Plagiarised work presented as original.
        </li>
      </ul>

      <h2>3. Prohibited Conduct</h2>
      <ul>
        <li>Circumventing credit limits, plan restrictions, or rate limits.</li>
        <li>Sharing account credentials or reselling access.</li>
        <li>
          Using the Service to train competing AI models without our express
          written permission.
        </li>
        <li>
          Submitting manuscripts to third-party platforms in violation of those
          platforms&rsquo; exclusivity terms (e.g. Amazon KDP Select).
        </li>
        <li>
          Scraping, reverse engineering, or interfering with the Service&rsquo;s
          operation.
        </li>
      </ul>

      <h2>4. AI-Specific Expectations</h2>
      <ul>
        <li>
          Review every AI-generated document before publishing. You are the
          author of record.
        </li>
        <li>
          Do not represent AI-generated content as human-authored where the
          destination platform requires disclosure (e.g. academic submissions,
          certain journalistic contexts).
        </li>
        <li>
          Do not use the Service to impersonate a specific real person&rsquo;s
          writing style in a way that deceives readers or harms their
          reputation.
        </li>
      </ul>

      <h2>5. Enforcement</h2>
      <p>
        Violations may result in content removal, credit forfeit, account
        suspension, or permanent termination. Severe violations (CSAM, threats
        of imminent violence) will be reported to law enforcement.
      </p>

      <h2>6. Reporting</h2>
      <p>
        Report suspected violations to{' '}
        <a href="mailto:support@penworth.ai">support@penworth.ai</a>. We
        investigate every report.
      </p>

      <h2>7. Changes</h2>
      <p>
        This policy may be updated as the platform evolves. Material changes
        are notified in-product.
      </p>
    </LegalDocumentLayout>
  );
}
