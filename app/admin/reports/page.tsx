/**
 * /admin/reports
 *
 * Admin-only landing page for the three investor/board/DD PDF report
 * templates. Layout-level is_admin gating in app/admin/layout.tsx
 * handles access control — this page can assume an admin user.
 *
 * The three report routes stream PDFs back with Content-Disposition:
 * attachment, so a simple <a href> works as the download mechanism.
 * No client-side state needed.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ReportCard {
  title: string;
  description: string;
  href: string;
  audience: string;
  windowDefault: string;
  accentColor: string;
}

const REPORTS: ReportCard[] = [
  {
    title: 'Monthly Investor Update',
    description:
      'Headline KPIs, revenue breakdown, user growth, and Guild summary for a single calendar month. Appropriate for monthly investor emails and capital-partner updates.',
    href: '/api/admin/reports/monthly-investor',
    audience: 'Investors · Monthly cadence',
    windowDefault: 'Previous complete calendar month',
    accentColor: '#0066cc',
  },
  {
    title: 'Quarterly Board Report',
    description:
      'Three-month window with per-month revenue comparison, full plan distribution, Guild tier breakdown, and activity-by-action summary. Appropriate for board meetings.',
    href: '/api/admin/reports/quarterly-board',
    audience: 'Board · Quarterly cadence',
    windowDefault: 'Previous completed quarter',
    accentColor: '#6b3fa0',
  },
  {
    title: 'Due Diligence Data Room Export',
    description:
      'Seven-year retention window. Raw audit-log events plus aggregate financials. Intended for investor DD, legal discovery, or regulator response. ⚠ Higher severity — generation is itself audit-logged.',
    href: '/api/admin/reports/dd-data-room',
    audience: 'DD · On-demand',
    windowDefault: '2555 days (7 years)',
    accentColor: '#c4591a',
  },
];

export default function AdminReportsPage() {
  return (
    <div className="max-w-5xl mx-auto px-8 py-12">
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2">Reports</h1>
        <p className="text-muted-foreground">
          Investor-grade PDFs pulled from the append-only audit_log.
          Each generation is itself audit-logged with your admin user
          and the period covered.
        </p>
      </div>

      <div className="space-y-4">
        {REPORTS.map((r) => (
          <div
            key={r.href}
            className="border rounded-lg p-6 bg-white"
            style={{ borderLeftWidth: '4px', borderLeftColor: r.accentColor }}
          >
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold mb-2">{r.title}</h2>
                <p className="text-sm text-gray-600 mb-4 leading-relaxed">{r.description}</p>
                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  <span><strong className="text-gray-700">Audience:</strong> {r.audience}</span>
                  <span><strong className="text-gray-700">Default window:</strong> {r.windowDefault}</span>
                </div>
              </div>
              <div className="flex-shrink-0">
                <a
                  href={r.href}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-white text-sm font-medium hover:opacity-90 transition-opacity"
                  style={{ background: r.accentColor }}
                >
                  Download PDF
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 p-5 bg-gray-50 border rounded-lg text-sm text-gray-600">
        <p className="font-semibold mb-1">Custom periods</p>
        <p>
          To override the default window, append a query parameter to
          the download URL:
        </p>
        <ul className="mt-2 space-y-1 text-xs font-mono">
          <li>Monthly Investor: <code>?month=2026-03</code></li>
          <li>Quarterly Board: <code>?quarter=2026-Q1</code></li>
          <li>DD Data Room: <code>?days=365</code> or <code>?days=90</code> (cap: 3650)</li>
        </ul>
      </div>

      <div className="mt-6 text-xs text-gray-500">
        <Link href="/admin" className="underline">← Back to Command Center</Link>
      </div>
    </div>
  );
}
