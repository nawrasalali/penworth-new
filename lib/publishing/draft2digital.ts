import JSZip from 'jszip';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredOAuthToken } from './oauth-providers';
import type { PublishingMetadata } from './metadata';

/**
 * Draft2Digital publish adapter.
 *
 * Flow (per D2D API v2):
 *   1. POST /api/v2/books with metadata JSON -> receive bookId
 *   2. POST /api/v2/books/{bookId}/manuscript with the EPUB or DOCX -> upload
 *   3. POST /api/v2/books/{bookId}/cover with JPG -> cover upload
 *   4. POST /api/v2/books/{bookId}/publish -> trigger distribution
 *
 * D2D then fans out to Apple, B&N, Kobo, OverDrive, Tolino, Vivlio, etc.
 * within hours. We record the bookId + status URL in project_publications
 * and the caller can poll for "published" state later.
 *
 * If any step fails we short-circuit, record the error in
 * project_publications.error_message, and let the author retry.
 */

const D2D_API = 'https://api.draft2digital.com/v2';

interface D2DBookPayload {
  title: string;
  subtitle?: string | null;
  description: string;
  language: string;
  author_name: string;
  author_bio?: string | null;
  keywords: string[];
  bisac_codes: string[];
  price_usd: number;
  is_free: boolean;
  audience?: string | null;
  contains_explicit: boolean;
  territories: string;
  publication_date?: string | null;
}

export interface D2DPublishResult {
  bookId: string;
  statusUrl: string;
  rawResponse: unknown;
}

export async function publishToDraft2Digital(args: {
  token: StoredOAuthToken;
  metadata: PublishingMetadata;
  manuscriptBuffer: Buffer;
  manuscriptFilename: string;
  coverBuffer?: Buffer | null;
}): Promise<D2DPublishResult> {
  const { token, metadata, manuscriptBuffer, manuscriptFilename, coverBuffer } = args;
  const auth = `${token.token_type || 'Bearer'} ${token.access_token}`;

  // --- Step 1: create book ---
  const payload: D2DBookPayload = {
    title: metadata.title,
    subtitle: metadata.subtitle,
    description: metadata.long_description || metadata.short_description || '',
    language: metadata.language || 'en',
    author_name: metadata.author_name,
    author_bio: metadata.author_bio,
    keywords: metadata.keywords || [],
    bisac_codes: metadata.bisac_codes || [],
    price_usd: metadata.is_free ? 0 : (metadata.price_usd || 2.99),
    is_free: metadata.is_free,
    audience: metadata.audience,
    contains_explicit: metadata.contains_explicit,
    territories: metadata.territories || 'worldwide',
    publication_date: metadata.publication_date,
  };

  const createResp = await fetch(`${D2D_API}/books`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => '');
    throw new D2DError(
      `Book creation failed (${createResp.status})`,
      text.slice(0, 400),
    );
  }

  const created = (await createResp.json()) as { id?: string; bookId?: string };
  const bookId = created.id || created.bookId;
  if (!bookId) {
    throw new D2DError('Book creation returned no ID', JSON.stringify(created).slice(0, 400));
  }

  // --- Step 2: upload manuscript ---
  await uploadBinary({
    url: `${D2D_API}/books/${bookId}/manuscript`,
    auth,
    buffer: manuscriptBuffer,
    filename: manuscriptFilename,
    contentType: manuscriptFilename.endsWith('.epub')
      ? 'application/epub+zip'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    errorContext: 'manuscript upload',
  });

  // --- Step 3: upload cover (optional but strongly recommended) ---
  if (coverBuffer) {
    try {
      await uploadBinary({
        url: `${D2D_API}/books/${bookId}/cover`,
        auth,
        buffer: coverBuffer,
        filename: 'cover.jpg',
        contentType: 'image/jpeg',
        errorContext: 'cover upload',
      });
    } catch (err) {
      // Cover failure is non-fatal — book is uploaded, author can add cover later
      console.warn('D2D cover upload failed (non-fatal):', err);
    }
  }

  // --- Step 4: trigger distribution ---
  const publishResp = await fetch(`${D2D_API}/books/${bookId}/publish`, {
    method: 'POST',
    headers: { Authorization: auth, Accept: 'application/json' },
  });

  if (!publishResp.ok) {
    const text = await publishResp.text().catch(() => '');
    throw new D2DError(
      `Publish trigger failed (${publishResp.status})`,
      text.slice(0, 400),
    );
  }

  const publishBody = await publishResp.json().catch(() => ({}));

  return {
    bookId,
    statusUrl: `${D2D_API}/books/${bookId}`,
    rawResponse: publishBody,
  };
}

async function uploadBinary(args: {
  url: string;
  auth: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  errorContext: string;
}) {
  const { url, auth, buffer, filename, contentType, errorContext } = args;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new D2DError(`${errorContext} failed (${resp.status})`, text.slice(0, 400));
  }
}

export class D2DError extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
    this.name = 'D2DError';
  }
}

/**
 * Build a minimal DOCX from a chapter list. Same shape as the bundle route;
 * kept local so this adapter has no dependency on route internals.
 */
export async function buildManuscriptDocx(
  title: string,
  author: string,
  chapters: Array<{ title: string; content: string; order_index: number }>,
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const paragraphs: string[] = [
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:sz w:val="56"/><w:b/></w:rPr><w:t>${esc(title)}</w:t></w:r></w:p>`,
    `<w:p><w:r><w:rPr><w:sz w:val="28"/><w:i/></w:rPr><w:t>by ${esc(author)}</w:t></w:r></w:p>`,
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
  ];

  for (const ch of [...chapters].sort((a, b) => a.order_index - b.order_index)) {
    paragraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:sz w:val="36"/><w:b/></w:rPr><w:t>${esc(ch.title)}</w:t></w:r></w:p>`,
    );
    for (const p of (ch.content || '').split(/\n\n+/)) {
      if (!p.trim()) continue;
      paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`);
    }
    paragraphs.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
  }

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n')}
  </w:body>
</w:document>`,
  );

  return await zip.generateAsync({ type: 'nodebuffer' });
}

function esc(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Tiny abstraction over loading the related project bits a publisher needs.
 * Fetches chapters + metadata + cover URL in one pass.
 */
export async function loadProjectForPublish(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<{
  title: string;
  chapters: Array<{ title: string; content: string; order_index: number }>;
  coverUrl: string | null;
} | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();
  if (!project) return null;

  const { data: chapters } = await supabase
    .from('chapters')
    .select('title, content, order_index')
    .eq('project_id', projectId)
    .eq('status', 'complete')
    .order('order_index');
  if (!chapters || chapters.length === 0) return null;

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('front_cover_url')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  return {
    title: project.title,
    chapters,
    coverUrl: session?.front_cover_url || null,
  };
}
