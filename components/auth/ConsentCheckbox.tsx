'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

/**
 * Three mandatory consent checkboxes for signup. The parent form owns the
 * submit button and calls `onChange` whenever the ALL-ACCEPTED boolean flips,
 * so the parent can disable submit until everything is checked.
 *
 * On a successful signup, the parent is expected to POST the accepted keys
 * to /api/legal/consent to record the audit trail.
 */
export function ConsentCheckbox({
  onChange,
  disabled,
}: {
  onChange: (allAccepted: boolean) => void;
  disabled?: boolean;
}) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({
    terms: false,
    privacy: false,
    acceptable_use: false,
  });

  function toggle(key: string) {
    const next = { ...accepted, [key]: !accepted[key] };
    setAccepted(next);
    const allOk = next.terms && next.privacy && next.acceptable_use;
    onChange(allOk);
  }

  return (
    <div className="space-y-2">
      <ConsentRow
        id="consent-terms"
        checked={accepted.terms}
        disabled={disabled}
        onToggle={() => toggle('terms')}
        label={
          <>
            I agree to the{' '}
            <Link
              href={LEGAL_DOCUMENTS.terms.path}
              target="_blank"
              className="text-primary hover:underline"
            >
              Terms of Service
            </Link>
          </>
        }
      />
      <ConsentRow
        id="consent-privacy"
        checked={accepted.privacy}
        disabled={disabled}
        onToggle={() => toggle('privacy')}
        label={
          <>
            I have read the{' '}
            <Link
              href={LEGAL_DOCUMENTS.privacy.path}
              target="_blank"
              className="text-primary hover:underline"
            >
              Privacy Policy
            </Link>
          </>
        }
      />
      <ConsentRow
        id="consent-aup"
        checked={accepted.acceptable_use}
        disabled={disabled}
        onToggle={() => toggle('acceptable_use')}
        label={
          <>
            I agree to the{' '}
            <Link
              href={LEGAL_DOCUMENTS.acceptable_use.path}
              target="_blank"
              className="text-primary hover:underline"
            >
              Acceptable Use Policy
            </Link>
          </>
        }
      />
    </div>
  );
}

function ConsentRow({
  id,
  checked,
  disabled,
  onToggle,
  label,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-2 text-sm cursor-pointer select-none"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
      />
      <span className="text-muted-foreground leading-relaxed">{label}</span>
    </label>
  );
}
