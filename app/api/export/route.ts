import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWatermarkStatus } from '@/lib/watermark';

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
  frontCoverUrl: string | null;
  backCoverUrl: string | null;
}

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

    // Fetch project with chapters
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

    // v2 watermark logic (lib/watermark.ts):
    // - Paid tier (pro/max/enterprise) -> no watermark
    // - Free + has_purchased_credits -> no watermark
    // - Free + has_referred_users -> no watermark
    // - Otherwise -> small footer watermark
    const watermarkStatus = await getWatermarkStatus(supabase, user.id);
    const includeBranding = watermarkStatus.shouldShowWatermark;

    // Sort chapters by order
    const chapters = (project.chapters || []).sort(
      (a: Chapter, b: Chapter) => a.order_index - b.order_index
    );

    if (format === 'docx') {
      // Generate DOCX (with branding for free tier)
      const docxBuffer = await generateDOCX(project as Project, chapters, includeBranding);
      
      return new NextResponse(new Uint8Array(docxBuffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(project.title)}.docx"`,
        },
      });
    } else if (format === 'pdf') {
      // Load the interview session for cover images, author name, and the
      // editorial book title (which may differ from project.title). Mirrors
      // the resolution pattern in app/api/publishing/penworth-store/route.ts.
      const { data: session } = await supabase
        .from('interview_sessions')
        .select('author_name, book_title, front_cover_url, back_cover_url')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();

      const pdfExtras: PdfExtras = {
        bookTitle: session?.book_title ?? null,
        authorName: session?.author_name ?? null,
        frontCoverUrl: session?.front_cover_url ?? null,
        backCoverUrl: session?.back_cover_url ?? null,
      };

      // Generate PDF (with branding for free tier)
      const pdfBuffer = await generatePDF(project as Project, chapters, includeBranding, pdfExtras);

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(pdfExtras.bookTitle || project.title)}.pdf"`,
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export document' },
      { status: 500 }
    );
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').slice(0, 50);
}

async function generateDOCX(project: Project, chapters: Chapter[], includeBranding: boolean = true): Promise<Buffer> {
  // Simple DOCX generation using minimal XML structure
  // In production, use a library like docx or officegen
  
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

  // Small footer watermark per v2 spec: single discrete line
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

  // Create a minimal valid DOCX (ZIP file)
  // For production, use proper DOCX library
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // Add required files for DOCX
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

function drawFullBleedImage(
  doc: PDFKit.PDFDocument,
  buf: Buffer,
  pageW: number,
  pageH: number,
) {
  // pdfkit's `cover` option: scale to fill the given box, cropping any excess.
  // Not in the public TypeScript types on every pdfkit version, so cast.
  doc.image(buf, 0, 0, {
    cover: [pageW, pageH],
    align: 'center',
    valign: 'center',
  } as unknown as PDFKit.Mixins.ImageOption);
}

function drawPlainCover(
  doc: PDFKit.PDFDocument,
  title: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  const startY = pageH / 2 - 80;
  doc.font('Helvetica-Bold')
    .fontSize(42)
    .fillColor('#000')
    .text(title, 72, startY, {
      width: pageW - 144,
      align: 'center',
    });
  if (author) {
    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(18).fillColor('#333').text(
      `by ${author}`,
      {
        width: pageW - 144,
        align: 'center',
      },
    );
  }
}

function drawTitlePage(
  doc: PDFKit.PDFDocument,
  title: string,
  author: string | null,
  pageW: number,
  pageH: number,
) {
  const startY = pageH / 2 - 60;
  doc.font('Helvetica-Bold')
    .fontSize(36)
    .fillColor('#000')
    .text(title, 72, startY, {
      width: pageW - 144,
      align: 'center',
    });
  if (author) {
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(16).fillColor('#333').text(
      `by ${author}`,
      {
        width: pageW - 144,
        align: 'center',
      },
    );
  }
}

function drawChapterTitlePage(
  doc: PDFKit.PDFDocument,
  chapterNumber: number,
  chapterTitle: string,
  pageW: number,
  pageH: number,
) {
  const startY = pageH / 2 - 80;
  doc.font('Helvetica').fontSize(14).fillColor('#666').text(
    `Chapter ${chapterNumber}`,
    72,
    startY,
    {
      width: pageW - 144,
      align: 'center',
    },
  );
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#000').text(
    chapterTitle,
    {
      width: pageW - 144,
      align: 'center',
    },
  );
}

function drawToc(
  doc: PDFKit.PDFDocument,
  entries: { n: number; title: string; page: number }[],
  pageW: number,
) {
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#000').text(
    'Table of Contents',
    72,
    96,
    {
      width: pageW - 144,
      align: 'left',
    },
  );
  doc.moveDown(1.5);

  for (const entry of entries) {
    const y = doc.y;
    const pageNumberWidth = 40;
    const labelWidth = pageW - 144 - pageNumberWidth - 8;
    const label = `${entry.n}.  ${entry.title}`;

    doc.font('Helvetica').fontSize(12).fillColor('#111');
    doc.text(label, 72, y, {
      width: labelWidth,
      align: 'left',
      ellipsis: true,
      lineBreak: false,
    });
    doc.text(String(entry.page), pageW - 72 - pageNumberWidth, y, {
      width: pageNumberWidth,
      align: 'right',
      lineBreak: false,
    });
    doc.moveDown(0.6);
  }
}

async function generatePDF(
  project: Project,
  chapters: Chapter[],
  includeBranding: boolean,
  extras: PdfExtras,
): Promise<Buffer> {
  // Book-shaped PDF: full-bleed front cover, title page, table of contents
  // with real page numbers, per-chapter title pages, full-bleed back cover.
  // Watermark footer (free tier only) is stamped on content pages only —
  // not on covers, title page, or ToC.
  const PDFDocument = (await import('pdfkit')).default;

  // Fetch covers in parallel up front so the render loop doesn't block.
  const [frontCover, backCover] = await Promise.all([
    fetchCoverBuffer(extras.frontCoverUrl),
    fetchCoverBuffer(extras.backCoverUrl),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        bufferPages: true, // required so we can rewind to fill ToC and stamp footers
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

      // Pages excluded from watermark stamping (covers, title, ToC).
      const chromePages = new Set<number>();

      const title = extras.bookTitle || project.title;
      const author = extras.authorName;

      // ===== 1. Front cover =====
      if (frontCover) {
        drawFullBleedImage(doc, frontCover, pageW, pageH);
      } else {
        drawPlainCover(doc, title, author, pageW, pageH);
      }
      chromePages.add(currentPage());

      // ===== 2. Title page =====
      doc.addPage();
      drawTitlePage(doc, title, author, pageW, pageH);
      chromePages.add(currentPage());

      // ===== 3. Table of contents placeholder =====
      // Reserve a single page for ToC. Filled in on a second pass once
      // chapter body start pages are known.
      doc.addPage();
      const tocPageIdx = currentPage();
      chromePages.add(tocPageIdx);

      // ===== 4. Chapters =====
      const chapterEntries: { n: number; title: string; page: number }[] = [];

      chapters.forEach((chapter, idx) => {
        // Chapter title page
        doc.addPage();
        drawChapterTitlePage(doc, idx + 1, chapter.title, pageW, pageH);

        // Chapter body starts on the next page. Record that page number for
        // the ToC (display 1-indexed from the start of the PDF).
        doc.addPage();
        const bodyStart = currentPage();
        chapterEntries.push({ n: idx + 1, title: chapter.title, page: bodyStart + 1 });

        doc.font('Helvetica').fontSize(12).fillColor('#111');
        const paragraphs = (chapter.content || '')
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        for (const para of paragraphs) {
          const softWrapped = para.replace(/\n/g, ' ');
          doc.text(softWrapped, {
            align: 'left',
            paragraphGap: 8,
            lineGap: 2,
          });
        }
      });

      // ===== 5. Back cover =====
      doc.addPage();
      if (backCover) {
        drawFullBleedImage(doc, backCover, pageW, pageH);
      }
      // Even if there's no back cover image, this page is still chrome
      // (blank) and should not get a watermark.
      chromePages.add(currentPage());

      // ===== Second pass: fill in ToC =====
      doc.switchToPage(tocPageIdx);
      drawToc(doc, chapterEntries, pageW);

      // ===== Third pass: watermark on content pages only =====
      if (includeBranding) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          if (chromePages.has(i)) continue;
          doc.switchToPage(i);
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888').text(
            'by penworth.ai',
            72,
            pageH - 40,
            {
              align: 'center',
              width: pageW - 144,
              lineBreak: false,
            },
          );
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
