'use client';

import { useState } from 'react';

export default function CopyButton({
  text,
  label = 'Copy link',
  copiedLabel = '✓ Copied',
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {}
      }}
      className="rounded-md bg-[#d4af37] px-5 py-3 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
