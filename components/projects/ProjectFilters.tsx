'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { CONTENT_TYPE_LABELS } from '@/lib/utils';

interface ProjectFiltersProps {
  statusOptions: string[];
  typeOptions: string[];
}

export function ProjectFilters({ statusOptions, typeOptions }: ProjectFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const currentStatus = searchParams.get('status') || '';
  const currentType = searchParams.get('type') || '';
  const currentQ = searchParams.get('q') || '';

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/projects?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = formData.get('q') as string;
    updateFilter('q', q);
  };

  return (
    <div className="flex flex-wrap items-center gap-4 mb-6">
      <form onSubmit={handleSearch} className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          name="q"
          placeholder="Search projects..."
          defaultValue={currentQ}
          className="pl-9"
        />
      </form>
      <div className="flex items-center gap-2">
        <select
          value={currentStatus}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={currentType}
          onChange={(e) => updateFilter('type', e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer"
        >
          <option value="">All Types</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {CONTENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
