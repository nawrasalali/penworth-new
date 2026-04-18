/**
 * Shared PDF rendering for admin investor/board/DD reports.
 *
 * Three report templates (monthly-investor.ts, quarterly-board.ts,
 * dd-export.ts) all render through this pdfkit-based engine. Keeping
 * the layout primitives here ensures visual consistency across all
 * investor-facing PDFs.
 *
 * The engine exposes a ReportBuilder class rather than a functional
 * API because pdfkit itself is stateful (cursor position, current
 * font, page buffer). Wrapping it in a class with named helper
 * methods (heading, kpi, table, divider) keeps the report templates
 * focused on content rather than low-level pdfkit calls.
 *
 * DESIGN: Letter size, 1-inch margins, Helvetica everywhere. The
 * typeface consistency matters — investor-grade PDFs should not
 * switch fonts mid-document. Branding is Penworth wordmark + date
 * on every page footer.
 */

import type PDFDocument from 'pdfkit';

type PDFKitDoc = InstanceType<typeof PDFDocument>;

export interface ReportMeta {
  title: string;
  /** e.g. 'Monthly Investor Update' */
  subtitle: string;
  /** Human period label, e.g. 'March 2026' */
  periodLabel: string;
  /** ISO timestamp when the report was generated */
  generatedAt: string;
  /** Which admin triggered the generation */
  generatedByEmail: string;
}

export interface KpiCard {
  label: string;
  /** Already-formatted value string — '$42,351.00' / '+12.3%' / '1,204' */
  value: string;
  /** Optional context like 'vs. last period' or a tiny comparison */
  context?: string;
}

export interface TableRow {
  cells: string[];
}

/**
 * Wrapper class — call helpers to add content, then end() returns the
 * accumulated Buffer.
 *
 * Usage:
 *
 *   const b = await ReportBuilder.create(meta);
 *   b.coverPage();
 *   b.section('Revenue');
 *   b.kpis([...]);
 *   b.divider();
 *   b.section('Activity');
 *   b.table(['Date', 'Action'], [...]);
 *   const pdf = await b.end();
 */
export class ReportBuilder {
  private doc: PDFKitDoc;
  private chunks: Buffer[] = [];
  private endedPromise: Promise<void>;
  private meta: ReportMeta;

  private constructor(doc: PDFKitDoc, meta: ReportMeta) {
    this.doc = doc;
    this.meta = meta;

    this.endedPromise = new Promise<void>((resolve, reject) => {
      this.doc.on('end', () => resolve());
      this.doc.on('error', reject);
    });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
  }

  static async create(meta: ReportMeta): Promise<ReportBuilder> {
    const PDFDocumentCtor = (await import('pdfkit')).default;
    const doc = new PDFDocumentCtor({
      size: 'LETTER',
      margins: { top: 72, bottom: 90, left: 72, right: 72 },
      bufferPages: true, // needed for the footer stamp pass
      info: {
        Title: meta.title,
        Subject: meta.subtitle,
        Author: 'Penworth.ai',
        Creator: 'Penworth Admin Reports',
        Producer: 'Penworth',
      },
    });
    return new ReportBuilder(doc, meta);
  }

  // --------------------------------------------------------------------------
  // Layout primitives
  // --------------------------------------------------------------------------

  /** Title page — big title, subtitle, period, generated-by footer */
  coverPage(): void {
    const { doc, meta } = this;

    // Vertical centring is a common investor-PDF convention.
    doc.y = 200;

    doc.font('Helvetica-Bold').fontSize(36).fillColor('#111').text(meta.title, { align: 'center' });
    doc.moveDown(0.75);
    doc.font('Helvetica').fontSize(18).fillColor('#555').text(meta.subtitle, { align: 'center' });
    doc.moveDown(2.5);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#111').text(meta.periodLabel, { align: 'center' });

    // Meta block at the bottom
    doc.y = 640;
    doc.font('Helvetica').fontSize(10).fillColor('#777');
    doc.text(`Generated ${formatDate(meta.generatedAt)}`, { align: 'center' });
    doc.text(`by ${meta.generatedByEmail}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).text('CONFIDENTIAL — Not for external distribution without prior approval', { align: 'center' });

    doc.fillColor('#000');
  }

  /** Major section header, starts a new page. */
  section(title: string, { newPage = true }: { newPage?: boolean } = {}): void {
    if (newPage) this.doc.addPage();
    this.doc.font('Helvetica-Bold').fontSize(20).fillColor('#111').text(title);
    this.doc.moveDown(0.5);
    // Accent rule under section headers
    const y = this.doc.y;
    this.doc.moveTo(72, y).lineTo(200, y).lineWidth(2).strokeColor('#0066cc').stroke();
    this.doc.moveDown(1.5);
  }

  /** Sub-section / heading-3 style. Does NOT start a new page. */
  subsection(title: string): void {
    this.doc.moveDown(0.5);
    this.doc.font('Helvetica-Bold').fontSize(14).fillColor('#333').text(title);
    this.doc.moveDown(0.5);
  }

  /** Plain body paragraph. */
  body(text: string): void {
    this.doc.font('Helvetica').fontSize(11).fillColor('#222');
    this.doc.text(text, { paragraphGap: 6, lineGap: 2, align: 'left' });
    this.doc.moveDown(0.5);
    this.doc.fillColor('#000');
  }

  /** A row of KPI cards — label above, big value below, optional context. */
  kpis(cards: KpiCard[]): void {
    const { doc } = this;
    const pageLeft = 72;
    const pageRight = doc.page.width - 72;
    const pageWidth = pageRight - pageLeft;

    const colsPerRow = Math.min(cards.length, 3);
    const gutter = 12;
    const cardWidth = (pageWidth - gutter * (colsPerRow - 1)) / colsPerRow;
    const cardHeight = 72;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const col = i % colsPerRow;
      if (col === 0 && i > 0) doc.moveDown(0.5);

      const x = pageLeft + col * (cardWidth + gutter);
      const y = doc.y;

      // Light border
      doc.roundedRect(x, y, cardWidth, cardHeight, 4).strokeColor('#e0e0e0').lineWidth(1).stroke();

      // Label (small, uppercase, dim)
      doc.font('Helvetica').fontSize(8).fillColor('#777')
        .text(card.label.toUpperCase(), x + 12, y + 10, { width: cardWidth - 24, lineBreak: false });

      // Value (big, bold, dark)
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#111')
        .text(card.value, x + 12, y + 25, { width: cardWidth - 24, lineBreak: false });

      // Context (small, dim)
      if (card.context) {
        doc.font('Helvetica').fontSize(8).fillColor('#888')
          .text(card.context, x + 12, y + 52, { width: cardWidth - 24, lineBreak: false });
      }

      // Advance y after the last card in a row
      if (col === colsPerRow - 1 || i === cards.length - 1) {
        doc.y = y + cardHeight + 12;
      }
    }

    doc.fillColor('#000');
  }

  /** Horizontal divider rule. */
  divider(): void {
    this.doc.moveDown(1);
    const y = this.doc.y;
    const pageLeft = 72;
    const pageRight = this.doc.page.width - 72;
    this.doc.moveTo(pageLeft, y).lineTo(pageRight, y).lineWidth(0.5).strokeColor('#dddddd').stroke();
    this.doc.moveDown(1);
  }

  /**
   * Data table — investor reports use these heavily for activity logs,
   * plan breakdowns, payout schedules.
   */
  table(headers: string[], rows: TableRow[], { columnWidths }: { columnWidths?: number[] } = {}): void {
    const { doc } = this;
    const pageLeft = 72;
    const pageRight = doc.page.width - 72;
    const pageWidth = pageRight - pageLeft;

    const widths = columnWidths ?? headers.map(() => pageWidth / headers.length);
    const rowHeight = 18;

    // Header row
    this.ensureSpace(rowHeight + 4);
    const headerY = doc.y;
    doc.rect(pageLeft, headerY - 2, pageWidth, rowHeight).fillColor('#f5f5f5').fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333');
    let x = pageLeft + 8;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, headerY + 2, { width: widths[i] - 8, lineBreak: false });
      x += widths[i];
    }
    doc.y = headerY + rowHeight;

    // Data rows
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    for (const row of rows) {
      this.ensureSpace(rowHeight + 4);
      const rowY = doc.y;
      x = pageLeft + 8;
      for (let i = 0; i < row.cells.length; i++) {
        const cell = row.cells[i] ?? '';
        doc.text(cell, x, rowY + 2, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
        x += widths[i];
      }
      doc.y = rowY + rowHeight;

      // Thin bottom border
      doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).lineWidth(0.3).strokeColor('#eeeeee').stroke();
    }

    doc.fillColor('#000');
    doc.moveDown(1);
  }

  /**
   * Simple bulleted list — for narrative sections in the Monthly Investor
   * Update.
   */
  bulletList(items: string[]): void {
    const { doc } = this;
    doc.font('Helvetica').fontSize(11).fillColor('#222');
    for (const item of items) {
      this.ensureSpace(20);
      doc.text(`• ${item}`, { paragraphGap: 4, lineGap: 2, indent: 8 });
    }
    doc.moveDown(0.5);
    doc.fillColor('#000');
  }

  /** Call this at the end. Stamps footers on every page then returns the buffer. */
  async end(): Promise<Buffer> {
    // Stamp footer + page numbers on every page
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);

      const footerY = this.doc.page.height - 45;
      this.doc.font('Helvetica').fontSize(8).fillColor('#999');
      this.doc.text(
        `Penworth ${this.meta.subtitle} · ${this.meta.periodLabel}`,
        72,
        footerY,
        { width: this.doc.page.width - 144, align: 'left', lineBreak: false },
      );
      this.doc.text(
        `Page ${i + 1} of ${range.count}`,
        72,
        footerY,
        { width: this.doc.page.width - 144, align: 'right', lineBreak: false },
      );
    }

    this.doc.end();
    await this.endedPromise;
    return Buffer.concat(this.chunks);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /** Adds a new page if there's less than `heightNeeded` left on the current one. */
  private ensureSpace(heightNeeded: number): void {
    const { doc } = this;
    const bottom = doc.page.height - 90; // respect bottom margin
    if (doc.y + heightNeeded > bottom) {
      doc.addPage();
    }
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
}
