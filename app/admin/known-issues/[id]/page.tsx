import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArrowLeft } from 'lucide-react';
import { KnownIssueEditor } from '../KnownIssueEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminKnownIssueEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pattern, error } = await supabase
    .from('nora_known_issues')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[admin/known-issues/:id] fetch error:', error);
    notFound();
  }
  if (!pattern) notFound();

  return (
    <div className="p-8">
      <Link
        href="/admin/known-issues"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Known Issues
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{pattern.title}</h1>
      <KnownIssueEditor mode="edit" pattern={pattern} />
    </div>
  );
}
