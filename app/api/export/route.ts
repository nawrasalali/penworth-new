import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWatermarkStatus } from '@/lib/watermark';

// =============================================================================
// Penworth book PDF export
// =============================================================================
// KDP-style trade paperback interior in a single PDF file.
// - 6x9" trim, serif body typography
// - Proper front matter: half title, title page, copyright, ToC
// - Chapter openers with label + cleaned title (no double-numbering)
// - Markdown in chapter content is parsed (headings, bold, italic) rather
//   than leaked as literal "#" characters
// - Back matter: About the Author (with optional photo)
// - Full-bleed front and back covers with title / author / blurb overlaid
//   on top of the image (the cover image is intentionally textless; see
//   app/api/covers/generate/route.ts)
// - Running header on body pages, page numbers on non-chrome pages only,
//   watermark scoped to body pages for the free tier
// =============================================================================

interface Chapter {
  id: string;
  title: string;
  content: string;
  order_index: number;
}

interface Project {
  id: string;
  title: string;
  description: string;
  content_type: string;
  chapters: Chapter[];
}

interface PdfExtras {
  bookTitle: string | null;
  authorName: string | null;
  aboutAuthor: string | null;
  authorPhotoUrl: string | null;
  frontCoverUrl: string | null;
  backCoverUrl: string | null;
  blurb: string | null;
}

// ---- KDP 6x9 trim geometry ----
const TRIM_W = 432;        // 6" * 72pt
const TRIM_H = 648;        // 9" * 72pt
const MARGIN_TOP = 54;     // 0.75"
const MARGIN_BOTTOM = 54;  // 0.75"
const MARGIN_INSIDE = 54;  // 0.75" — pdfkit lacks facing-page margins; use symmetric
const MARGIN_OUTSIDE = 54; // 0.75"

// Margins used on "chrome" pages (covers, title page, copyright, ToC,
// About the Author). Chrome pages use absolute positioning for all
// draws, so layout margins are irrelevant — but pdfkit also uses
// `page.margins` as the input to its text-overflow heuristic (it adds
// a page whenever `y + lineHeight > page.height - margins.bottom`).
// Zeroing margins on chrome pages prevents overlay draws at y > 594
// (e.g. back-cover blurb, footer stamps) from triggering phantom blank
// pages at the end of the document.
const CHROME_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };

// ---- Typography ----
// pdfkit ships these as built-in Type 1 fonts; no embedding needed.
const F_BODY = 'Times-Roman';
const F_BODY_ITALIC = 'Times-Italic';
const F_BODY_BOLD = 'Times-Bold';
const F_BODY_BOLD_ITALIC = 'Times-BoldItalic';
const F_HEAD = 'Times-Bold';
const F_SANS = 'Helvetica';
const F_SANS_BOLD = 'Helvetica-Bold';
const F_SANS_ITALIC = 'Helvetica-Oblique';

const BODY_SIZE = 11;
const BODY_LEADING = 3;
const PARA_GAP = 4;

// =============================================================================
// Top-level route handler
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, format } = body;

    if (!projectId || !['pdf', 'docx'].includes(format)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { data: project, error } = await supabase
      .from('projects')
      .select(`
        *,
        chapters (*)
      `)
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const watermarkStatus = await getWatermarkStatus(supabase, user.id);
    const includeBranding = watermarkStatus.shouldShowWatermark;

    const chapters = (project.chapters || []).sort(
      (a: Chapter, b: Chapter) => a.order_index - b.order_index,
    );

    if (format === 'docx') {
      const docxBuffer = await generateDOCX(project as Project, chapters, includeBranding);
      return new NextResponse(new Uint8Array(docxBuffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(project.title)}.docx"`,
        },
      });
    }

    if (format === 'pdf') {
      // Load editorial metadata used by the PDF only.
      const { data: session } = await supabase
        .from('interview_sessions')
        .select('author_name, book_title, front_cover_url, back_cover_url, about_author, author_photo_url')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();

      const extras: PdfExtras = {
        bookTitle: session?.book_title ?? null,
        authorName: session?.author_name ?? null,
        aboutAuthor: session?.about_author ?? null,
        authorPhotoUrl: session?.author_photo_url ?? null,
        frontCoverUrl: session?.front_cover_url ?? null,
        backCoverUrl: session?.back_cover_url ?? null,
        // No dedicated blurb column today; project.description is the
        // richest short marketing summary we have.
        blurb: (project.description || '').trim() || null,
      };

      const pdfBuffer = await generatePDF(project as Project, chapters, includeBranding, extras);

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(extras.bookTitle || project.title)}.pdf"`,
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Failed to export document' }, { status: 500 });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').slice(0, 50);
}

// =============================================================================
// DOCX export (unchanged from v1)
// =============================================================================

async function generateDOCX(project: Project, chapters: Chapter[], includeBranding: boolean = true): Promise<Buffer> {
  const content = chapters.map(ch => `
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>${escapeXml(ch.title)}</w:t></w:r>
    </w:p>
    ${ch.content.split('\n').map(para => `
      <w:p>
        <w:r><w:t>${escapeXml(para)}</w:t></w:r>
      </w:p>
    `).join('')}
  `).join('');

  const brandingFooter = includeBranding ? `
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
    </w:p>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r>
        <w:rPr><w:sz w:val="16"/><w:color w:val="888888"/><w:i/></w:rPr>
        <w:t>by penworth.ai</w:t>
      </w:r>
    </w:p>
  ` : '';

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>${escapeXml(project.title)}</w:t></w:r>
    </w:p>
    ${project.description ? `
    <w:p>
      <w:r><w:t>${escapeXml(project.description)}</w:t></w:r>
    </w:p>
    ` : ''}
    ${content}
    ${brandingFooter}
  </w:body>
</w:document>`;

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// PDF helpers
// =============================================================================

async function fetchCoverBuffer(url: string | null, timeoutMs = 8000): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arrBuf = await res.arrayBuffer();
    return Buffer.from(arrBuf);
  } catch {
    return null;
  }
}

/**
 * Pull the "Chapter N" label out of titles that the Writer agent produces
 * in the form "Chapter 3: Actual title...". Returns the label to display
 * on the chapter opener and the cleaned title (without the prefix). Front-
 * and back-matter entries like "Introduction" / "Conclusion" return with
 * label === null so they render unnumbered.
 *
 * Fixes v1's double-numbering bug: auto-numbering produced "Chapter 4"
 * on top of a title that already contained "Chapter 3:".
 */
function splitChapterTitle(raw: string): { label: string | null; clean: string } {
  const trimmed = (raw || '').trim();
  const m = trimmed.match(/^Chapter\s+(\d+)\s*[:\-—–.]\s*(.+)$/i);
  if (m) return { label: `Chapter ${m[1]}`, clean: m[2].trim() };
  const m2 = trimmed.match(/^Chapter\s+(\d+)\s*$/i);
  if (m2) return { label: `Chapter ${m2[1]}`, clean: '' };
  return { label: null, clean: trimmed };
}

/**
 * Split a book title on its first colon into (main, subtitle). Bestseller
 * covers treat the pre-colon portion as the primary title at display size
 * and the post-colon portion as the subtitle at a smaller italic size —
 * renders a 130-character monolithic title as two legible tiers instead
 * of nine wrapped lines.
 */
function splitTitle(full: string): { main: string; subtitle: string | null } {
  const s = (full || '').trim();
  const colonIdx = s.indexOf(':');
  if (colonIdx > 0 && colonIdx < s.length - 2) {
    const main = s.slice(0, colonIdx).trim();
    const sub = s.slice(colonIdx + 1).trim();
    if (main.length >= 3 && main.length <= 60) {
      return { main, subtitle: sub || null };
    }
  }
  return { main: s, subtitle: null };
}

interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
}

/**
 * Tokenize inline markdown into bold/italic/regular spans and strip the
 * delimiters. Handles **bold**, *italic*, _italic_. An unmatched `*` or
 * `_` falls through as literal text rather than being lost.
 */
function tokenizeInline(input: string): Span[] {
  const out: Span[] = [];
  let buf = '';
  let bold = false;
  let italic = false;
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ text: buf, bold, italic });
      buf = '';
    }
  };

  while (i < input.length) {
    // **bold**
    if (input[i] === '*' && input[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    // *italic*
    if (input[i] === '*') {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    // _italic_ — only at word boundaries to avoid breaking snake_case
    if (input[i] === '_') {
      const before = input[i - 1] ?? '';
      const after = input[i + 1] ?? '';
      if ((/[\s.,;:!?(\[{"'—–-]/.test(before) || i === 0) && /\S/.test(after)) {
        const close = input.indexOf('_', i + 1);
        if (close !== -1) {
          const afterClose = input[close + 1] ?? '';
          if (afterClose === '' || /[\s.,;:!?)\]}"'—–-]/.test(afterClose)) {
            flush();
            italic = true;
            buf += input.slice(i + 1, close);
            flush();
            italic = false;
            i = close + 1;
            continue;
          }
        }
      }
    }
    buf += input[i];
    i += 1;
  }
  flush();
  return out;
}

interface ContentBlock {
  kind: 'h2' | 'para';
  text: string;
}

/**
 * Parse a chapter's markdown-ish content into a stream of renderable blocks.
 *
 * - Strips the first leading "# ..." heading (duplicates the chapter title
 *   already drawn on the opener page).
 * - Treats any subsequent "# ..." or "## ..." as a section heading.
 * - Collapses single newlines inside a paragraph to spaces.
 * - Splits paragraphs on blank lines.
 * - Drops "---" / "***" horizontal rules.
 */
function parseChapterContent(raw: string): ContentBlock[] {
  const src = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!src) return [];

  const lines = src.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  if (start < lines.length && /^#\s+/.test(lines[start])) {
    start++;
    while (start < lines.length && lines[start].trim() === '') start++;
  }

  const blocks: ContentBlock[] = [];
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length) {
      const joined = paraBuf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) blocks.push({ kind: 'para', text: joined });
      paraBuf = [];
    }
  };

  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') { flushPara(); continue; }

    const h = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      flushPara();
      blocks.push({ kind: 'h2', text: h[2].trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushPara(); continue; }

    paraBuf.push(trimmed);
  }
  flushPara();
  return blocks;
}

// =============================================================================
// Draw helpers
// =============================================================================

function drawFullBleedImage(
  doc: PDFKit.PDFDocument,
  buf: Buffer,
  pageW: number,
  pageH: number,
) {
  doc.image(buf, 0, 0, {
    cover: [pageW, pageH],
    align: 'center',
    valign: 'center',
  } as unknown as PDFKit.Mixins.ImageOption);
}

function drawCoverOverlayBackdrop(doc: PDFKit.PDFDocument, pageW: number, pageH: number) {
  // Gradient fade from opaque black at the top edge to transparent a quarter
  // of the way down — keeps the imagery visible behind the title rather than
  // hiding it under a flat slab (v2 rendered ~35% of the cover as solid
  // black which buried the artwork). Same treatment, shorter, at the bottom
  // for the author byline.
  const topH = pageH * 0.30;
  const topGrad = doc.linearGradient(0, 0, 0, topH);
  topGrad.stop(0, '#000', 0.85);
  topGrad.stop(0.7, '#000', 0.45);
  topGrad.stop(1, '#000', 0);
  doc.rect(0, 0, pageW, topH).fill(topGrad);

  const botH = pageH * 0.14;
  const botY = pageH - botH;
  const botGrad = doc.linearGradient(0, botY, 0, pageH);
  botGrad.stop(0, '#000', 0);
  botGrad.stop(0.5, '#000', 0.55);
  botGrad.stop(1, '#000', 0.85);
  doc.rect(0, botY, pageW, botH).fill(botGrad);

  doc.fillColor('#000');
}

function drawFrontCoverOverlay(
  doc: PDFKit.PDFDocument,
  fullTitle: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  drawCoverOverlayBackdrop(doc, pageW, pageH);

  // Per CEO-090 (PDF v4): the cover only carries the main title — long
  // descriptive subtitles belong on the interior title page, not over the
  // cover art. We discard `subtitle` from splitTitle() here.
  const { main } = splitTitle(fullTitle);

  const titleBoxW = pageW - 48;
  const titleX = 24;

  // Main title — yellow (#FFD60A), high-contrast against the gradient
  // backdrop. Auto-scaled to stay inside roughly the top sixth of the page
  // regardless of length. Long titles shrink; short titles stay display-size.
  doc.fillColor('#FFD60A').font(F_HEAD);
  const mainMaxH = pageH * 0.14;
  let mainSize = 40;
  while (mainSize > 18) {
    doc.fontSize(mainSize);
    const h = doc.heightOfString(main, { width: titleBoxW, align: 'center' });
    if (h <= mainMaxH) break;
    mainSize -= 1;
  }
  const mainY = pageH * 0.05;
  doc.fontSize(mainSize).text(main, titleX, mainY, {
    width: titleBoxW, align: 'center',
  });

  // Author byline — bottom-left per CEO-090. Left-aligned to the same
  // 40 pt safe margin used elsewhere on the cover; uppercase + character
  // spacing preserved for typographic continuity with prior versions.
  if (author) {
    const authorY = pageH - 42;
    doc.fillColor('#FFF').font(F_SANS_BOLD).fontSize(12).text(
      author.toUpperCase(),
      40, authorY,
      { width: pageW - 80, align: 'left', characterSpacing: 3, lineBreak: false },
    );
  }

  doc.fillColor('#000');
}

function drawBackCoverOverlay(
  doc: PDFKit.PDFDocument,
  blurb: string | null,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  if (!blurb && !author) return;

  // Per CEO-092 the overlay extends from y=22% all the way to the
  // bottom edge of the page. The previous version stopped at y=94%
  // pageH, leaving a 6% strip at the bottom where the bare cover image
  // showed through — which the founder read (correctly) as the back
  // cover not being properly bled to the bottom edge. Underlying image
  // is drawFullBleedImage(0, 0, pageW, pageH) so the image itself is
  // edge-to-edge; this fix is purely about overlay coverage.
  doc.save();
  doc.fillOpacity(0.6);
  const overlayTop = pageH * 0.22;
  doc.rect(0, overlayTop, pageW, pageH - overlayTop).fill('#000');
  doc.restore();
  doc.fillOpacity(1);

  doc.fillColor('#FFF');
  const textX = 40;
  const textW = pageW - 80;

  if (blurb) {
    doc.font(F_BODY).fontSize(11).fillColor('#FFF').text(
      blurb, textX, pageH * 0.28,
      { width: textW, align: 'left', lineGap: 3 },
    );
  }

  if (author) {
    doc.font(F_BODY_ITALIC).fontSize(10).fillColor('#FFF').text(
      `— ${author}`,
      textX, pageH * 0.88,
      { width: textW, align: 'right', lineBreak: false },
    );
  }
  doc.fillColor('#000');
}

function drawPlainFrontCover(
  doc: PDFKit.PDFDocument,
  title: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  doc.rect(0, 0, pageW, pageH).fill('#1a1a1a');
  doc.fillColor('#FFF').font(F_HEAD).fontSize(30).text(
    title, 40, pageH * 0.3,
    { width: pageW - 80, align: 'center' },
  );
  if (author) {
    doc.font(F_SANS_BOLD).fontSize(13).fillColor('#FFF').text(
      author.toUpperCase(),
      40, pageH * 0.87,
      { width: pageW - 80, align: 'center', characterSpacing: 3, lineBreak: false },
    );
  }
  doc.fillColor('#000');
}

function drawTitlePage(
  doc: PDFKit.PDFDocument,
  fullTitle: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  const x = MARGIN_OUTSIDE;
  const boxW = pageW - MARGIN_INSIDE - MARGIN_OUTSIDE;
  const { main, subtitle } = splitTitle(fullTitle);

  // Main title — serif, bold, large, centered in the upper third.
  doc.fillColor('#000').font(F_HEAD);
  let mainSize = 28;
  while (mainSize > 16) {
    doc.fontSize(mainSize);
    const h = doc.heightOfString(main, { width: boxW, align: 'center' });
    if (h <= pageH * 0.14) break;
    mainSize -= 1;
  }
  doc.fontSize(mainSize).text(main, x, pageH * 0.22, {
    width: boxW, align: 'center',
  });

  // Subtitle — italic serif, smaller, sat below the main title.
  if (subtitle) {
    doc.moveDown(0.8);
    doc.font(F_BODY_ITALIC);
    let subSize = Math.max(11, Math.round(mainSize * 0.48));
    while (subSize > 10) {
      doc.fontSize(subSize);
      const h = doc.heightOfString(subtitle, { width: boxW, align: 'center' });
      if (h <= pageH * 0.12) break;
      subSize -= 1;
    }
    doc.fontSize(subSize).fillColor('#333').text(subtitle, x, doc.y, {
      width: boxW, align: 'center',
    });
  }

  // Ornament rule
  const ruleY = pageH * 0.6;
  doc.save();
  doc.strokeColor('#999').lineWidth(0.6);
  doc.moveTo(pageW / 2 - 40, ruleY).lineTo(pageW / 2 + 40, ruleY).stroke();
  doc.restore();

  // Author
  if (author) {
    doc.fillColor('#333').font(F_BODY_ITALIC).fontSize(12).text(
      'by', x, ruleY + 20,
      { width: boxW, align: 'center' },
    );
    doc.moveDown(0.3);
    doc.fillColor('#000').font(F_HEAD).fontSize(15).text(
      author, x, doc.y,
      { width: boxW, align: 'center' },
    );
  }

  // No bottom-of-page imprint. The mid-page "by {author}" line already
  // serves as the author imprint; a second author line at the bottom of
  // the title page (which CEO-090's first cut added in place of the
  // 'PENWORTH' brand stamp) duplicates the byline and reads as a
  // layout defect. Per CEO-092, the slot is left empty.
  doc.fillColor('#000');
}

function drawCopyrightPage(
  doc: PDFKit.PDFDocument,
  title: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  const x = MARGIN_OUTSIDE;
  const boxW = pageW - MARGIN_INSIDE - MARGIN_OUTSIDE;
  const year = new Date().getFullYear();
  const holder = author || 'the Author';

  doc.font(F_BODY_ITALIC).fontSize(9).fillColor('#888').text(
    title, x, MARGIN_TOP, { width: boxW, align: 'left' },
  );

  const lines = [
    `Copyright © ${year} ${holder}`,
    '',
    'All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without the prior written permission of the copyright holder, except in the case of brief quotations embodied in critical reviews and certain other non-commercial uses permitted by copyright law.',
    '',
    'Published by Penworth',
    `First Edition, ${year}`,
    '',
    'This book was written with the assistance of Penworth (penworth.ai), a platform that helps authors develop their ideas into published work while preserving the author\'s voice and intent.',
  ];

  doc.fillColor('#222').font(F_BODY).fontSize(9);
  let yy = pageH - MARGIN_BOTTOM - 240;
  for (const line of lines) {
    if (line === '') { yy += 8; continue; }
    const h = doc.heightOfString(line, { width: boxW, align: 'left', lineGap: 2 });
    doc.text(line, x, yy, { width: boxW, align: 'left', lineGap: 2 });
    yy += h + 4;
  }
  doc.fillColor('#000');
}

interface TocEntry {
  label: string | null;
  title: string;
  page: number;
}

/**
 * Render the ToC. Each entry is a row with the label + title on the left,
 * a dotted leader, and the page number on the right.
 *
 * v3: pdfkit's `lineBreak: false` is not enough to prevent wrapping when
 * text exceeds the `width` parameter — it still breaks at whitespace
 * inside the too-wide string. v3 truncated with an ellipsis to keep the
 * row single-line.
 *
 * v4 (CEO-090): Founder reports the ellipsis truncation looks like a
 * defect. We replace it with explicit multi-line wrapping using a
 * hanging indent. The page number renders on the first line; the dotted
 * leader runs from the LAST line's text-end to the page-number column.
 * Layout preserved for short titles (single line, no change). The
 * accompanying vitest gate (__tests__/export/toc-leaders.test.ts) fails
 * the build if any ToC row contains the ellipsis character (U+2026).
 */
function drawToc(
  doc: PDFKit.PDFDocument,
  entries: TocEntry[],
  pageW: number,
) {
  const x = MARGIN_OUTSIDE;
  const boxW = pageW - MARGIN_INSIDE - MARGIN_OUTSIDE;

  doc.fillColor('#000').font(F_HEAD).fontSize(22).text(
    'Contents', x, MARGIN_TOP,
    { width: boxW, align: 'left' },
  );

  let y = MARGIN_TOP + 50;
  const pageNumBoxW = 30;
  const leaderGap = 14;          // visual space between text end and leader dots
  const leftMaxWidth = boxW - pageNumBoxW - leaderGap - 8;
  const lineHeight = 16;          // tight per-line spacing for wrapped titles
  const rowGapAfter = 10;         // gap between successive ToC entries

  for (const entry of entries) {
    const useItalic = !entry.label;
    const rawDisplay = entry.label
      ? `${entry.label}    ${entry.title}`.trim()
      : entry.title;

    doc.font(useItalic ? F_BODY_ITALIC : F_BODY).fontSize(11).fillColor('#111');

    // Compute the natural rendered height with pdfkit's wrapping enabled.
    // We measure once, then call .text() with the same width so wrapping
    // is consistent. lineBreak defaults to true; do NOT pass false here.
    const wrappedHeight = doc.heightOfString(rawDisplay, {
      width: leftMaxWidth,
      align: 'left',
    });

    doc.text(rawDisplay, x, y, {
      width: leftMaxWidth,
      align: 'left',
    });

    // Dotted leader: anchored to the LAST line of the (possibly wrapped)
    // title. Approximate the last-line text width by re-measuring the
    // tail of the string after the last visual line break. Cheap
    // heuristic: if the string fit on one line (height ~= lineHeight),
    // measure the whole string; otherwise measure the longest single
    // word (very long titles tend to break before a long final word).
    const isMultiLine = wrappedHeight > lineHeight + 2;
    const lastLineApproxWidth = isMultiLine
      ? Math.min(leftMaxWidth, doc.widthOfString(rawDisplay.split(/\s+/).slice(-3).join(' ')))
      : doc.widthOfString(rawDisplay);
    const lastLineY = y + wrappedHeight - lineHeight + 4;
    const textEnd = x + lastLineApproxWidth + 4;
    const pageNumX = x + boxW - pageNumBoxW;

    if (pageNumX - textEnd > leaderGap) {
      doc.save();
      doc.fillColor('#999');
      let leaderX = textEnd + 4;
      while (leaderX < pageNumX - 6) {
        doc.circle(leaderX, lastLineY + 7, 0.6).fill();
        leaderX += 4;
      }
      doc.restore();
    }

    // Page number — right-aligned, ALWAYS on the first row of the entry
    // so it lines up with the chapter label rather than drifting down
    // for long titles.
    doc.font(F_BODY).fontSize(11).fillColor('#111').text(
      String(entry.page),
      pageNumX, y,
      { width: pageNumBoxW, align: 'right', lineBreak: false },
    );

    y += wrappedHeight + rowGapAfter;
  }
}

function drawChapterOpener(
  doc: PDFKit.PDFDocument,
  label: string | null,
  cleanTitle: string,
  pageW: number,
  pageH: number,
) {
  const x = MARGIN_OUTSIDE;
  const boxW = pageW - MARGIN_INSIDE - MARGIN_OUTSIDE;
  const y = pageH * 0.33;

  if (label) {
    doc.fillColor('#666').font(F_SANS).fontSize(10).text(
      label.toUpperCase(),
      x, y,
      { width: boxW, align: 'center', characterSpacing: 4, lineBreak: false },
    );
    doc.moveDown(1);
  }

  const titleSize = cleanTitle.length > 60 ? 19 : 24;
  doc.fillColor('#000').font(F_HEAD).fontSize(titleSize).text(
    cleanTitle,
    x, label ? doc.y : y,
    { width: boxW, align: 'center' },
  );

  // Ornament rule under the title
  doc.moveDown(1.2);
  const ruleY = doc.y;
  doc.save();
  doc.strokeColor('#999').lineWidth(0.6);
  doc.moveTo(pageW / 2 - 30, ruleY).lineTo(pageW / 2 + 30, ruleY).stroke();
  doc.restore();
}

function drawAboutAuthor(
  doc: PDFKit.PDFDocument,
  author: string | null,
  bio: string | null,
  photoBuf: Buffer | null,
  pageW: number,
  pageH: number,
) {
  void pageH;
  const x = MARGIN_OUTSIDE;
  const boxW = pageW - MARGIN_INSIDE - MARGIN_OUTSIDE;

  doc.fillColor('#000').font(F_HEAD).fontSize(20).text(
    'About the Author', x, MARGIN_TOP,
    { width: boxW, align: 'center' },
  );

  let y = MARGIN_TOP + 50;

  if (photoBuf) {
    const photoW = 120;
    const photoX = (pageW - photoW) / 2;
    try {
      doc.image(photoBuf, photoX, y, { fit: [photoW, photoW], align: 'center', valign: 'center' });
      y += photoW + 24;
    } catch {
      // Bad image bytes — skip photo and fall through.
    }
  }

  if (author) {
    doc.font(F_HEAD).fontSize(14).text(author, x, y, { width: boxW, align: 'center' });
    y = doc.y + 16;
  }

  if (bio) {
    doc.font(F_BODY).fontSize(11).fillColor('#222').text(
      bio, x, y,
      { width: boxW, align: 'justify', lineGap: 3 },
    );
  }
  doc.fillColor('#000');
}

/**
 * Render one paragraph with inline bold/italic. If firstOfChapter,
 * uppercase the first 3 words as a small-caps-style opener — a cheap
 * substitute for a true drop cap that still reads as professional.
 */
function drawParagraph(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: { firstOfChapter: boolean },
) {
  const spans = tokenizeInline(text);
  if (spans.length === 0) return;

  if (opts.firstOfChapter) {
    const first = spans[0];
    const words = first.text.split(/\s+/).filter(w => w.length > 0);
    const openerCount = Math.min(3, words.length);
    const opener = words.slice(0, openerCount).join(' ').toUpperCase();
    const rest = words.slice(openerCount).join(' ');
    spans[0] = {
      text: rest ? (' ' + rest) : '',
      bold: first.bold,
      italic: first.italic,
    };
    doc.font(F_SANS_BOLD).fontSize(BODY_SIZE).fillColor('#000').text(
      opener,
      {
        continued: rest.length > 0 || spans.length > 1,
        characterSpacing: 0.3,
      },
    );
  }

  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (!s.text) continue;
    const font = s.bold && s.italic
      ? F_BODY_BOLD_ITALIC
      : s.bold
        ? F_BODY_BOLD
        : s.italic
          ? F_BODY_ITALIC
          : F_BODY;
    const isLast = i === spans.length - 1;
    doc.font(font).fontSize(BODY_SIZE).fillColor('#111').text(
      s.text,
      {
        continued: !isLast,
        align: 'justify',
        lineGap: BODY_LEADING,
        paragraphGap: PARA_GAP,
      },
    );
  }
}

// =============================================================================
// Main generator
// =============================================================================

async function generatePDF(
  project: Project,
  chapters: Chapter[],
  includeBranding: boolean,
  extras: PdfExtras,
): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  const [frontCover, backCover, authorPhoto] = await Promise.all([
    fetchCoverBuffer(extras.frontCoverUrl),
    fetchCoverBuffer(extras.backCoverUrl),
    fetchCoverBuffer(extras.authorPhotoUrl),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [TRIM_W, TRIM_H],
        margins: {
          top: MARGIN_TOP,
          bottom: MARGIN_BOTTOM,
          left: MARGIN_INSIDE,
          right: MARGIN_OUTSIDE,
        },
        bufferPages: true,
        info: {
          Title: extras.bookTitle || project.title,
          Author: extras.authorName || '',
          Subject: project.description || '',
          Creator: 'Penworth',
          Producer: 'Penworth',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;

      const currentPage = () => {
        const r = doc.bufferedPageRange();
        return r.start + r.count - 1;
      };

      // Role of every page for the final stamping pass.
      //   chrome: no page number, no running header, no watermark
      //   opener: page number only
      //   body:   page number + running header + watermark (free tier)
      const pageRole = new Map<number, { kind: 'chrome' | 'opener' | 'body'; header?: string }>();

      const title = extras.bookTitle || project.title;
      const author = extras.authorName;

      // 1. Front cover
      // The initial page is auto-created by the PDFDocument constructor
      // with document margins. Override to zero for the same reason
      // CHROME_MARGINS exists: overlay draws use absolute positioning,
      // and non-zero margins here cause pdfkit to misinterpret those
      // draws as overflowing the page.
      doc.page.margins = { ...CHROME_MARGINS };
      if (frontCover) {
        drawFullBleedImage(doc, frontCover, pageW, pageH);
        drawFrontCoverOverlay(doc, title, author, pageW, pageH);
      } else {
        drawPlainFrontCover(doc, title, author, pageW, pageH);
      }
      pageRole.set(currentPage(), { kind: 'chrome' });

      // 2. Title page
      // (The half-title page was dropped in v3 — for titles that don't
      //  have a meaningfully shorter half-title form, it produced a page
      //  that duplicated the title page's content and read as a bug.)
      //
      // All chrome pages are created with zero margins so absolute-
      // positioned draws (overlays, blurbs, author bios) can't trigger
      // pdfkit's text-overflow heuristic — which was the source of the
      // "heaps of empty pages" after the back cover.
      doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait', margins: CHROME_MARGINS });
      drawTitlePage(doc, title, author, pageW, pageH);
      pageRole.set(currentPage(), { kind: 'chrome' });

      // 3. Copyright
      doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait', margins: CHROME_MARGINS });
      drawCopyrightPage(doc, title, author, pageW, pageH);
      pageRole.set(currentPage(), { kind: 'chrome' });

      // 4. Table of contents placeholder — filled after the body so
      //    the page numbers reflect the ACTUAL displayed page numbers
      //    in the printed footer, not the absolute PDF page indices.
      doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait', margins: CHROME_MARGINS });
      const tocPageIdx = currentPage();
      pageRole.set(tocPageIdx, { kind: 'chrome' });

      // 5. Chapters
      // Each tocEntry carries the absolute buffer index of its opener
      // page; the displayed page number is computed in pass 2 once the
      // whole book is laid out.
      interface TocEntryBuild {
        label: string | null;
        title: string;
        openerAbs: number;
      }
      const tocEntries: TocEntryBuild[] = [];

      for (const chapter of chapters) {
        const { label, clean } = splitChapterTitle(chapter.title);
        const displayTitle = clean || chapter.title;

        // Chapter opener
        doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait' });
        drawChapterOpener(doc, label, displayTitle, pageW, pageH);
        const openerAbs = currentPage();
        pageRole.set(openerAbs, { kind: 'opener' });

        // Body
        doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait' });
        const bodyStart = currentPage();
        const runningHeader = (label
          ? `${label} · ${displayTitle}`
          : displayTitle).toUpperCase();
        pageRole.set(bodyStart, { kind: 'body', header: runningHeader });

        tocEntries.push({ label, title: displayTitle, openerAbs });

        const blocks = parseChapterContent(chapter.content);
        let firstParaOfChapter = true;

        doc.fillColor('#111').font(F_BODY).fontSize(BODY_SIZE);

        for (const block of blocks) {
          const pagesBefore = doc.bufferedPageRange().count;

          if (block.kind === 'h2') {
            doc.moveDown(0.6);
            doc.font(F_HEAD).fontSize(14).fillColor('#000').text(
              block.text, { paragraphGap: 6, align: 'left' },
            );
            doc.moveDown(0.3);
            doc.font(F_BODY).fontSize(BODY_SIZE).fillColor('#111');
          } else {
            drawParagraph(doc, block.text, { firstOfChapter: firstParaOfChapter });
            firstParaOfChapter = false;
          }

          // Any new pages spawned by auto-flowing text inherit the
          // same running header.
          const pagesAfter = doc.bufferedPageRange().count;
          for (let p = pagesBefore; p < pagesAfter; p++) {
            const idx2 = doc.bufferedPageRange().start + p;
            if (!pageRole.has(idx2)) {
              pageRole.set(idx2, { kind: 'body', header: runningHeader });
            }
          }
        }
      }

      // 6. About the Author
      // Skip this page entirely when the data is too thin to make a
      // real page — a 3-word bio on an otherwise blank 6x9 reads as a
      // layout bug.
      const bioLen = (extras.aboutAuthor || '').trim().length;
      const hasUsefulAuthorData =
        (bioLen >= 40) || !!authorPhoto || (!!extras.authorName && bioLen > 0);
      if (hasUsefulAuthorData) {
        doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait', margins: CHROME_MARGINS });
        drawAboutAuthor(doc, extras.authorName, extras.aboutAuthor, authorPhoto, pageW, pageH);
        pageRole.set(currentPage(), { kind: 'chrome' });
      }

      // 7. Back cover
      doc.addPage({ size: [TRIM_W, TRIM_H], layout: 'portrait', margins: CHROME_MARGINS });
      if (backCover) {
        drawFullBleedImage(doc, backCover, pageW, pageH);
        drawBackCoverOverlay(doc, extras.blurb, extras.authorName, pageW, pageH);
      } else if (extras.blurb) {
        doc.rect(0, 0, pageW, pageH).fill('#1a1a1a');
        drawBackCoverOverlay(doc, extras.blurb, extras.authorName, pageW, pageH);
      }
      pageRole.set(currentPage(), { kind: 'chrome' });

      // =========================================================
      // Pass 2: compute displayed page numbers, then fill in ToC
      // =========================================================
      // The PRINTED page number in the footer starts at 1 on the first
      // non-chrome page (the Introduction opener) and increments only
      // on non-chrome pages. The ToC must reference THESE numbers, not
      // the absolute PDF page indices — v2's bug was pointing the ToC
      // at page 7 while the footer said 1 on the same page.
      const range = doc.bufferedPageRange();
      const displayedNumByAbs = new Map<number, number>();
      let counter = 0;
      for (let i = range.start; i < range.start + range.count; i++) {
        const role = pageRole.get(i);
        if (role?.kind === 'chrome') continue;
        counter++;
        displayedNumByAbs.set(i, counter);
      }

      const tocEntriesFinal: TocEntry[] = tocEntries.map(e => ({
        label: e.label,
        title: e.title,
        page: displayedNumByAbs.get(e.openerAbs) ?? 0,
      }));

      doc.switchToPage(tocPageIdx);
      drawToc(doc, tocEntriesFinal, pageW);

      // =========================================================
      // Pass 3: running header + page number + watermark
      // =========================================================
      // pdfkit's text flow auto-adds a new page when the cursor plus the
      // line height would exceed page.maxY() (= pageH - page.margins.bottom).
      // Our footer stamps sit at y = pageH - 30 which is BELOW the 54pt
      // bottom margin, so without this guard pdfkit appends one overflow
      // page per non-chrome page — the source of v2/v3's "heaps of empty
      // pages after the back cover". Since pass 3 uses absolute
      // positioning, the margins serve no layout purpose here; zeroing
      // them per page before stamping suppresses the heuristic.
      for (let i = range.start; i < range.start + range.count; i++) {
        const role = pageRole.get(i) || { kind: 'body' as const, header: '' };
        if (role.kind === 'chrome') continue;

        doc.switchToPage(i);
        const displayedNum = displayedNumByAbs.get(i);
        if (!displayedNum) continue;

        // Suppress pdfkit's overflow heuristic for this stamping round.
        doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };

        // Running header: body pages only (openers get no header).
        if (role.kind === 'body' && role.header) {
          doc.font(F_SANS).fontSize(8).fillColor('#888').text(
            role.header,
            MARGIN_OUTSIDE, 28,
            {
              width: pageW - MARGIN_INSIDE - MARGIN_OUTSIDE,
              align: 'center',
              lineBreak: false,
              characterSpacing: 1.5,
            },
          );
        }

        // Page number: body pages only. Openers count toward the
        // numbering but the number itself is suppressed (trade-book
        // convention — opener is a display page).
        if (role.kind === 'body') {
          doc.font(F_BODY).fontSize(9).fillColor('#666').text(
            String(displayedNum),
            MARGIN_OUTSIDE, pageH - 30,
            {
              width: pageW - MARGIN_INSIDE - MARGIN_OUTSIDE,
              align: 'center',
              lineBreak: false,
            },
          );

          if (includeBranding) {
            doc.font(F_SANS_ITALIC).fontSize(7).fillColor('#aaa').text(
              'by penworth.ai',
              pageW - MARGIN_OUTSIDE - 80, pageH - 30,
              { width: 80, align: 'right', lineBreak: false },
            );
          }
        }
      }
      doc.fillColor('#000');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
