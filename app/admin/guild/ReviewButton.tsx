'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Variant = 'primary' | 'success' | 'destructive';

const STYLES: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  success: 'bg-green-600 text-white hover:bg-green-700',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
};

export default function ReviewButton({
  applicationId,
  action,
  label,
  variant,
}: {
  applicationId: string;
  action: 'invite' | 'accept' | 'decline';
  label: string;
  variant: Variant;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    let reason: string | null = null;
    if (action === 'decline') {
      reason = prompt(
        'Decision note for your records (optional — not shown to applicant):',
      );
      if (reason === null) return; // user cancelled
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/guild/admin/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: applicationId,
          action,
          decision_reason: reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      router.refresh();
    } catch (e: any) {
      alert(`Error: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${STYLES[variant]}`}
    >
      {loading ? 'Processing…' : label}
    </button>
  );
}
