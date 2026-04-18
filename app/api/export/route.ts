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
      // Generate PDF (with branding for free tier)
      const pdfBuffer = await generatePDF(project as Project, chapters, includeBranding);
      
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(project.title)}.pdf"`,
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

async function generatePDF(project: Project, chapters: Chapter[], includeBranding: boolean = true): Promise<Buffer> {
  // Real PDF generation via pdfkit. Renders cover page (title + description),
  // then each chapter as a new page with full body content, then optional
  // branding footer on the final page.
  //
  // Previous implementation was a hand-rolled 500-byte PDF stub that only
  // emitted chapter TITLES with no body content — any real export was
  // effectively empty.
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      // Letter size matches KDP standard for non-fiction (6x9 also supported,
      // but Letter is the more common default and we set exact margins).
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 72, bottom: 72, left: 72, right: 72 }, // 1 inch
        bufferPages: true, // needed so we can stamp the footer on each page
        info: {
          Title: project.title,
          Subject: project.description || '',
          Creator: 'Penworth',
          Producer: 'Penworth',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // === Cover page ===
      doc.font('Helvetica-Bold').fontSize(36).text(project.title, {
        align: 'center',
      });

      if (project.description) {
        doc.moveDown(2);
        doc.font('Helvetica').fontSize(14).fillColor('#444').text(
          project.description,
          { align: 'center' },
        );
        doc.fillColor('#000');
      }

      // === Chapters ===
      for (const chapter of chapters) {
        doc.addPage();

        // Chapter title
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#000').text(
          chapter.title,
          { align: 'left' },
        );
        doc.moveDown(1);

        // Chapter body — preserve paragraph breaks, use readable body font
        doc.font('Helvetica').fontSize(12).fillColor('#111');

        const paragraphs = (chapter.content || '')
          .split(/\n\s*\n/) // split on blank lines
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        for (const para of paragraphs) {
          // Collapse single \n inside a paragraph to a space (soft-wrap),
          // which is how most editors store prose.
          const softWrapped = para.replace(/\n/g, ' ');
          doc.text(softWrapped, {
            align: 'left',
            paragraphGap: 8,
            lineGap: 2,
          });
        }
      }

      // === Watermark footer on every page ===
      // Only rendered for users whose tier triggers it (free users without
      // credit purchases / referrals). Paid tiers get no footer.
      if (includeBranding) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888').text(
            'by penworth.ai',
            72, // left margin
            doc.page.height - 40, // 40pt above bottom edge
            {
              align: 'center',
              width: doc.page.width - 144,
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
