/**
 * Single source of truth for legal document versions.
 *
 * Update the `version` string whenever the document text materially changes.
 * The version is written into consent_records on acceptance and is what the
 * Compliance Agent reads to determine which users are consented to the
 * current version vs. an outdated version.
 *
 * Version convention: ISO date of publication, e.g. '2026-04-17'. Increment
 * by setting today's date the day the change ships.
 *
 * Effective date is displayed to users; it may legitimately be the same as
 * the version (they're the same date) or lag it slightly (we update the doc
 * and give users a 30-day grace period to re-consent).
 */
export const LEGAL_DOCUMENTS = {
  terms: {
    key: 'terms' as const,
    title: 'Terms of Service',
    version: '2026-04-17',
    effectiveDate: '2026-04-17',
    path: '/legal/terms',
  },
  privacy: {
    key: 'privacy' as const,
    title: 'Privacy Policy',
    version: '2026-04-17',
    effectiveDate: '2026-04-17',
    path: '/legal/privacy',
  },
  acceptable_use: {
    key: 'acceptable_use' as const,
    title: 'Acceptable Use Policy',
    version: '2026-04-17',
    effectiveDate: '2026-04-17',
    path: '/legal/acceptable-use',
  },
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_DOCUMENTS;
export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_DOCUMENTS) as LegalDocumentKey[];
