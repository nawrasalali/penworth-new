/**
 * Smoke tests for lib/reports/pdf-builder.ts — the shared PDF renderer
 * for admin investor/board/DD reports.
 *
 * Tests the ReportBuilder class by exercising every public method
 * against a synthetic data set, then parsing the resulting PDF with
 * pdf-parse (same dependency as __tests__/export-pdf.test.ts) to
 * assert that the content lands in the output.
 *
 * These tests do NOT hit the three report endpoints themselves — those
 * depend on Supabase via createServiceClient, which would require
 * larger-scale mocking. The endpoints consume the same ReportBuilder,
 * so a regression in the builder would break all three reports. That's
 * the surface this test covers.
 */

import { describe, it, expect } from 'vitest';
import { ReportBuilder } from '@/lib/reports/pdf-builder';

// ---------------------------------------------------------------------------
// Helper — pdf-parse v2 class API (verified in __tests__/export-pdf.test.ts)
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse }: any = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lib/reports/pdf-builder — ReportBuilder', () => {
  it('renders a minimal cover-page-only PDF', async () => {
    const b = await ReportBuilder.create({
      title: 'Penworth.ai',
      subtitle: 'Smoke Test Report',
      periodLabel: 'April 2026',
      generatedAt: '2026-04-18T19:00:00Z',
      generatedByEmail: 'smoke@penworth.ai',
    });
    b.coverPage();
    const pdf = await b.end();

    // Real PDF, not a stub
    expect(pdf.length).toBeGreaterThan(1500);
    expect(pdf.slice(0, 4).toString('binary')).toBe('%PDF');

    const text = await extractPdfText(pdf);
    expect(text).toContain('Penworth.ai');
    expect(text).toContain('Smoke Test Report');
    expect(text).toContain('April 2026');
    expect(text).toContain('smoke@penworth.ai');
    expect(text).toContain('CONFIDENTIAL');
  });

  it('exercises every content primitive — section, subsection, body, kpis, table, bulletList, divider', async () => {
    const b = await ReportBuilder.create({
      title: 'Penworth.ai',
      subtitle: 'Full Content Test',
      periodLabel: 'Q1 2026',
      generatedAt: '2026-04-18T19:00:00Z',
      generatedByEmail: 'full@penworth.ai',
    });

    b.coverPage();

    b.section('Revenue Analysis');
    b.kpis([
      { label: 'Net Revenue',  value: '$42,351.00', context: '+12% vs last period' },
      { label: 'Active Users', value: '1,204',      context: '87 paid' },
      { label: 'Guild Size',   value: '9' },
    ]);

    b.body(
      'Distinctive narrative text with the phrase capillary_action_marker ' +
      'that will not appear anywhere else in the document, so a positive ' +
      'match proves the body() method rendered into the PDF.',
    );

    b.subsection('Transaction Detail');
    b.table(
      ['Date', 'Action', 'Entity'],
      [
        { cells: ['2026-04-18 12:00', 'subscription.activate', 'sub_alpha_7'] },
        { cells: ['2026-04-18 13:15', 'credit_pack.purchase',  'session_beta_2'] },
        { cells: ['2026-04-18 14:45', 'refund.issue',          'charge_gamma_9'] },
      ],
    );

    b.divider();
    b.section('Operations');
    b.bulletList([
      'reticular_formation_signal',
      'tessellation_of_hope',
      'saltatory_conduction_note',
    ]);

    const pdf = await b.end();

    // Sanity
    expect(pdf.length).toBeGreaterThan(3000);
    expect(pdf.slice(0, 4).toString('binary')).toBe('%PDF');

    const text = await extractPdfText(pdf);

    // Section headers
    expect(text).toContain('Revenue Analysis');
    expect(text).toContain('Operations');

    // Subsection
    expect(text).toContain('Transaction Detail');

    // KPI labels + values
    expect(text).toContain('NET REVENUE');
    expect(text).toContain('$42,351.00');
    expect(text).toContain('+12% vs last period');
    expect(text).toContain('ACTIVE USERS');
    expect(text).toContain('1,204');
    expect(text).toContain('GUILD SIZE');

    // Body prose — the distinctive marker must land
    expect(text).toContain('capillary_action_marker');

    // Table — headers AND body cells
    expect(text).toContain('Date');
    expect(text).toContain('Action');
    expect(text).toContain('Entity');
    expect(text).toContain('subscription.activate');
    expect(text).toContain('sub_alpha_7');
    expect(text).toContain('refund.issue');
    expect(text).toContain('charge_gamma_9');

    // Bullet list — distinctive markers
    expect(text).toContain('reticular_formation_signal');
    expect(text).toContain('tessellation_of_hope');
    expect(text).toContain('saltatory_conduction_note');
  });

  it('stamps a footer with the report subtitle + period + page numbers on every page', async () => {
    const b = await ReportBuilder.create({
      title: 'Penworth.ai',
      subtitle: 'Multi-Page Smoke',
      periodLabel: 'March 2026',
      generatedAt: '2026-04-18T19:00:00Z',
      generatedByEmail: 'footer@penworth.ai',
    });

    b.coverPage();
    b.section('Page 2');
    b.body('Content.');
    b.section('Page 3');
    b.body('More content.');
    b.section('Page 4');
    b.body('Yet more content.');

    const pdf = await b.end();
    const text = await extractPdfText(pdf);

    // Footer appears on every page — our 4+ section document will have
    // at least 4 footers. The subtitle string should appear multiple
    // times (once on each page).
    const subtitleOccurrences = text.split('Multi-Page Smoke').length - 1;
    expect(subtitleOccurrences).toBeGreaterThanOrEqual(4);

    // Page-number footer pattern
    expect(text).toMatch(/Page 1 of \d+/);
    expect(text).toMatch(/Page 2 of \d+/);
    expect(text).toMatch(/Page 3 of \d+/);
    expect(text).toMatch(/Page 4 of \d+/);
  });

  it('handles a table with more rows than fit on one page (ensureSpace pagination)', async () => {
    const b = await ReportBuilder.create({
      title: 'Penworth.ai',
      subtitle: 'Overflow Test',
      periodLabel: 'April 2026',
      generatedAt: '2026-04-18T19:00:00Z',
      generatedByEmail: 'overflow@penworth.ai',
    });
    b.coverPage();
    b.section('Many Rows');

    // 60 rows will overflow a single page. Each row ~18pt; page has
    // ~650pt usable content area at Letter / 1-inch margins. 60 × 18 =
    // 1080pt → spans ~2 pages. Test that pagination kicks in.
    const rows = Array.from({ length: 60 }, (_, i) => ({
      cells: [
        `row_${String(i).padStart(3, '0')}`,
        `marker_${i}_unique`,
        `entity_${i}`,
      ],
    }));
    b.table(['ID', 'Marker', 'Entity'], rows);

    const pdf = await b.end();
    const text = await extractPdfText(pdf);

    // Every row must appear — none are silently dropped at page break
    expect(text).toContain('row_000');
    expect(text).toContain('row_029'); // mid
    expect(text).toContain('row_059'); // last
    expect(text).toContain('marker_0_unique');
    expect(text).toContain('marker_59_unique');
  });

  it('produces a valid PDF even with zero content past the cover', async () => {
    // Edge case: period with no data. DD export on a fresh install
    // would hit this. Must not produce a broken PDF.
    const b = await ReportBuilder.create({
      title: 'Penworth.ai',
      subtitle: 'Empty Period',
      periodLabel: 'Test',
      generatedAt: '2026-04-18T19:00:00Z',
      generatedByEmail: 'empty@penworth.ai',
    });
    b.coverPage();
    b.section('Activity');
    b.body('No events during this period.');

    const pdf = await b.end();
    expect(pdf.slice(0, 4).toString('binary')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1500);

    const text = await extractPdfText(pdf);
    expect(text).toContain('No events during this period');
    expect(text).toContain('Activity');
  });
});
