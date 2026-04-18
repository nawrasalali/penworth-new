import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDistanceToNow } from 'date-fns';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Task 2.5 — /admin/known-issues list page.
 *
 * Shows all 11 seeded patterns + any admins have added. Sort by
 * match_count DESC so most-common issues surface first.
 */
export default async function AdminKnownIssuesPage() {
  const supabase = await createClient();

  const { data: patterns, error } = await supabase
    .from('nora_known_issues')
    .select(
      'id, pattern_slug, title, surface, symptom_keywords, auto_fix_tool, auto_fix_tier, escalate_after_attempts, match_count, resolution_success_rate, active, last_matched_at, updated_at',
    )
    .order('match_count', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[admin/known-issues] fetch error:', error);
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Known Issues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(patterns || []).length} pattern{(patterns || []).length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/admin/known-issues/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          <Plus className="mr-2 h-4 w-4" />
          New pattern
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Slug</th>
              <th className="px-4 py-3 text-left font-medium">Surface</th>
              <th className="px-4 py-3 text-left font-medium">Auto-fix</th>
              <th className="px-4 py-3 text-right font-medium">Matches</th>
              <th className="px-4 py-3 text-right font-medium">Success</th>
              <th className="px-4 py-3 text-right font-medium">Last match</th>
              <th className="px-4 py-3 text-right font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {!patterns || patterns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  No known-issue patterns yet.
                </td>
              </tr>
            ) : (
              patterns.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="max-w-md truncate px-4 py-3">
                    <Link
                      href={`/admin/known-issues/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.pattern_slug}</td>
                  <td className="px-4 py-3 text-xs uppercase">{p.surface ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {p.auto_fix_tool ? (
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                        {p.auto_fix_tool}
                        {p.auto_fix_tier ? ` (T${p.auto_fix_tier})` : ''}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {p.match_count ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {p.resolution_success_rate != null
                      ? `${Math.round(Number(p.resolution_success_rate) * 100)}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {p.last_matched_at
                      ? formatDistanceToNow(new Date(p.last_matched_at), { addSuffix: true })
                      : 'never'}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {p.active ? (
                      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-600">
                        on
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-gray-500">
                        off
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
