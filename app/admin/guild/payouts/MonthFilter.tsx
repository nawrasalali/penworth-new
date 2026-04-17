'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function MonthFilter({ months }: { months: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get('month') ?? '';
  const status = params.get('status') ?? 'queued';

  return (
    <select
      defaultValue={current}
      onChange={(e) => {
        const month = e.target.value;
        const q = new URLSearchParams();
        q.set('status', status);
        if (month) q.set('month', month);
        router.push(`/admin/guild/payouts?${q.toString()}`);
      }}
      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
    >
      <option value="">All months</option>
      {months.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
