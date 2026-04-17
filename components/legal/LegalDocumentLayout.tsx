import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';

/**
 * Shared frame for legal documents. Keeps visual language consistent across
 * Terms / Privacy / Acceptable Use. Renders:
 *   - back-to-home link
 *   - document title
 *   - pending-counsel-review banner (remove once counsel signs off)
 *   - effective date + version
 *   - document body (children)
 */
export function LegalDocumentLayout({
  title,
  version,
  effectiveDate,
  children,
}: {
  title: string;
  version: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-6">
          <span>Version {version}</span>
          <span aria-hidden>·</span>
          <span>Effective {effectiveDate}</span>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-8 text-sm text-amber-900 dark:text-amber-200">
          <strong className="font-semibold">Pending legal review.</strong>{' '}
          This document is a placeholder scaffold and has not yet been reviewed
          by commercial counsel. Commercial terms will be finalised before
          public launch.
        </div>

        <article className="prose prose-sm dark:prose-invert max-w-none">
          {children}
        </article>
      </div>
    </div>
  );
}
