import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { KnownIssueEditor } from '../KnownIssueEditor';

export const dynamic = 'force-dynamic';

export default function AdminKnownIssueNewPage() {
  return (
    <div className="p-8">
      <Link
        href="/admin/known-issues"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Known Issues
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">New pattern</h1>
      <KnownIssueEditor mode="create" />
    </div>
  );
}
