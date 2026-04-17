'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function AnalystRefresh({
  hasExisting,
  isFresh,
}: {
  hasExisting: boolean;
  isFresh: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/guild/agents/analyst', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? 'Failed');
          return;
        }
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Network error');
      }
    });
  }

  const label = !hasExisting
    ? 'Run analysis'
    : isFresh
      ? 'Re-run'
      : 'Generate today\'s report';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={isPending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {isPending ? 'Analysing…' : label}
      </button>
      {error && <div className="text-[10px] text-red-600">{error}</div>}
    </div>
  );
}
