'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function StrategistGenerate({
  hasExisting,
}: {
  hasExisting: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (
      hasExisting &&
      !confirm(
        'Generating a new plan supersedes the current active plan. ' +
          'The old plan stays in history but will no longer be "active". Continue?',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/guild/agents/strategist', {
          method: 'POST',
        });
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={isPending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {isPending
          ? 'Planning…'
          : hasExisting
            ? 'Regenerate plan'
            : 'Generate plan'}
      </button>
      {error && <div className="text-[10px] text-red-600">{error}</div>}
    </div>
  );
}
