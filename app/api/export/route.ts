import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    // Check subscription tier for export access
    const { data: orgMember } = await supabase
      .from('org_members')
      .select('organizations(subscription_tier)')
      .eq('user_id', user.id)
      .single();

    const tier = (orgMember?.organizations as any)?.subscription_tier || 'free';

    if (tier === 'free') {
      return NextResponse.json(
        { error: 'Export requires Pro plan or higher. Upgrade to export your documents.' },
        { status: 403 }
      );
    }

    // Sort chapters by order
    const chapters = (project.chapters || []).sort(
      (a: Chapter, b: Chapter) => a.order_index - b.order_index
    );

    // Generate document content
    const documentContent = generateDocumentContent(project as Project, chapters);

    if (format === 'docx') {
      // Generate DOCX
      const docxBuffer = await generateDOCX(project as Project, chapters);
      
      return new NextResponse(new Uint8Array(docxBuffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${sanitizeFilename(project.title)}.docx"`,
        },
      });
    } else if (format === 'pdf') {
      // Generate PDF
      const pdfBuffer = await generatePDF(project as Project, chapters);
      
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

function generateDocumentContent(project: Project, chapters: Chapter[]): string {
  let content = `# ${project.title}\n\n`;
  
  if (project.description) {
    content += `${project.description}\n\n---\n\n`;
  }

  for (const chapter of chapters) {
    content += `## ${chapter.title}\n\n`;
    content += `${chapter.content}\n\n`;
  }

  return content;
}

async function generateDOCX(project: Project, chapters: Chapter[]): Promise<Buffer> {
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

async function generatePDF(project: Project, chapters: Chapter[]): Promise<Buffer> {
  // Simple PDF generation
  // In production, use a library like pdfkit, puppeteer, or similar
  
  // Create minimal PDF structure
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 200 >>
stream
BT
/F1 24 Tf
50 700 Td
(${escapePdf(project.title)}) Tj
0 -30 Td
/F1 12 Tf
${chapters.map((ch, i) => `0 -20 Td (${escapePdf(ch.title)}) Tj`).join('\n')}
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000518 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
600
%%EOF`;

  return Buffer.from(content, 'utf-8');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapePdf(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
