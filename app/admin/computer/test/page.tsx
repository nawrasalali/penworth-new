import Link from 'next/link';
import { TestClient } from './TestClient';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminComputerTestPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <Link
        href="/admin/computer"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All sessions
      </Link>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Admin · Penworth Computer
        </div>
        <h1 className="text-3xl font-bold tracking-tight mt-1">Test harness</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Rehearse the Penworth Computer flow against a stub book. This verifies
          Browserbase sessions, Playwright CDP, Claude computer-use, screenshot
          capture, file upload, and 2FA handoff — without risking a real manuscript.
          The stub book is created once per admin and reused on every run.
        </p>
      </div>

      <TestClient />
    </div>
  );
}
