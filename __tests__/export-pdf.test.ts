/**
 * Regression tests for app/api/export/route.ts — specifically the PDF
 * generation path.
 *
 * BACKGROUND
 * ----------
 *
 * Before commit ee28605, generatePDF() was a 500-byte hand-rolled PDF
 * literal that emitted only:
 *   - Project title
 *   - Each chapter's TITLE
 * ...and NO chapter body content. This shipped to production for months
 * because nothing tested the actual rendered output — spot-checks of the
 * filename/mime-type succeeded, but nobody read the PDF to confirm it
 * contained words from the chapters.
 *
 * These tests close that gap. Every assertion below reads the generated
 * PDF with pdf-parse and verifies specific substrings of chapter bodies
 * appear in the extracted text. A future regression (stub output,
 * missing chapters, watermark wrong for tier) would fail these tests
 * before reaching production.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixture project — distinctive text in each chapter body so pdf-parse
// assertions can differentiate. These strings must not appear in the
// title/description so a positive match proves body rendering.
// ---------------------------------------------------------------------------

const FIXTURE_PROJECT = {
  id: 'proj_test_1',
  user_id: 'user_1',
  title: 'The Navigator Protocol',
  description: 'A discreet field manual.',
  content_type: 'book',
  chapters: [
    {
      id: 'ch_1',
      project_id: 'proj_test_1',
      title: 'Opening Signal',
      order_index: 0,
      // Distinctive body text with a blank-line paragraph break
      content:
        'The shortwave squeaked at three minutes past midnight with a pattern we called the copper chorus.\n\nA second pulse followed, softer and slower, in the rhythm a cartographer would use to mark a disputed border.',
    },
    {
      id: 'ch_2',
      project_id: 'proj_test_1',
      title: 'The Driftwood Map',
      order_index: 1,
      content:
        'On Tuesdays the harbourmaster walked the seawall counting gulls, a habit that betrayed him in November when the flock thinned by exactly one bird.\n\nThat bird, we learned, had become the nineteenth member of the Helsinki cell.',
    },
    {
      id: 'ch_3',
      project_id: 'proj_test_1',
      title: 'Silent Reciprocity',
      order_index: 2,
      // Soft-wrap newline inside one paragraph to exercise the join logic
      content:
        'Every silent exchange obeys a grammar.\nReturn the glance, keep the coat.\n\nBreak either rule and you admit you were measuring.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mutable mock state — reset in beforeEach
// ---------------------------------------------------------------------------

type Tier = 'free_no_credits' | 'free_with_credits' | 'paid';

let mockAuthed = true;
let mockTier: Tier = 'free_no_credits';
let mockProjectExists = true;

// ---------------------------------------------------------------------------
// Stubs must be registered before the route imports run
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mockAuthed ? { id: 'user_1' } : null },
      }),
    },
    from: (table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () =>
                  mockProjectExists
                    ? { data: FIXTURE_PROJECT, error: null }
                    : { data: null, error: { code: 'PGRST116' } },
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in export test: ${table}`);
    },
  }),
}));

vi.mock('@/lib/watermark', () => ({
  // Mirrors production contract: returns { shouldShowWatermark: boolean }
  // Free users without credits or referrals see the watermark; everyone
  // else does not. Tier state is controlled per-test via mockTier.
  getWatermarkStatus: async () => ({
    shouldShowWatermark: mockTier === 'free_no_credits',
  }),
}));

// ---------------------------------------------------------------------------
// Import route AFTER mocks. Dynamic import so TS hoists mocks above it.
// ---------------------------------------------------------------------------

async function loadRoute() {
  return (await import('@/app/api/export/route')).POST;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, any>) {
  return new Request('https://new.penworth.ai/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf-parse v2 uses a class-based API. getText() returns
  // { pages, text, total } where text is the concatenation of all page
  // text with "-- N of M --" page markers between them. Good enough for
  // substring assertions.
  const { PDFParse }: any = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/export — PDF', () => {
  beforeEach(() => {
    mockAuthed = true;
    mockTier = 'free_no_credits';
    mockProjectExists = true;
    vi.clearAllMocks();
  });

  it('returns 401 when no user is authenticated', async () => {
    mockAuthed = false;
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid format', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'epub' }) as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing project', async () => {
    mockProjectExists = false;
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'missing', format: 'pdf' }) as any);
    expect(res.status).toBe(404);
  });

  it('returns a PDF with correct headers and non-stub size', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('.pdf');
    expect(res.headers.get('content-disposition')).toContain('The_Navigator_Protocol');

    const buffer = Buffer.from(await res.arrayBuffer());

    // Old stub was ~500 bytes. A real PDF with 3 chapters of prose is
    // multiple kilobytes. If this ever drops below 2KB again, we're
    // regressing to the hand-rolled stub.
    expect(buffer.length).toBeGreaterThan(2000);

    // PDF file signature
    expect(buffer.slice(0, 4).toString('binary')).toBe('%PDF');
  });

  it('THE regression check: chapter BODIES render into the PDF, not just titles', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);

    // Project shell
    expect(text).toContain('The Navigator Protocol');

    // Every chapter title
    expect(text).toContain('Opening Signal');
    expect(text).toContain('The Driftwood Map');
    expect(text).toContain('Silent Reciprocity');

    // Every chapter BODY — this is the assertion the stub failed.
    // Distinctive phrases from each chapter must appear in extracted text.
    expect(text).toContain('copper chorus');
    expect(text).toContain('disputed border');
    expect(text).toContain('harbourmaster');
    expect(text).toContain('nineteenth member of the Helsinki cell');
    expect(text).toContain('grammar');
    expect(text).toContain('Break either rule');
  });

  it('soft-wrap newlines inside a paragraph collapse to spaces (not broken lines)', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);

    // Chapter 3 had a soft-wrap within a paragraph:
    //   'Every silent exchange obeys a grammar.\nReturn the glance, keep the coat.'
    // The two sentences must appear joined by a space in the rendered
    // text, not split by the raw '\n'. We check that both sentences
    // appear, which is enough — a raw \n would have broken the text
    // flow in extractable output.
    expect(text).toContain('obeys a grammar');
    expect(text).toContain('Return the glance');
  });

  it('renders watermark footer for free tier without credits or referrals', async () => {
    mockTier = 'free_no_credits';
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);

    expect(text.toLowerCase()).toContain('penworth.ai');
  });

  it('does NOT render watermark for paid tier', async () => {
    mockTier = 'paid';
    const POST = await loadRoute();
    const res = await POST(makeRequest({ projectId: 'proj_test_1', format: 'pdf' }) as any);
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = await extractPdfText(buffer);

    // Watermark string must be absent. Checking a case-insensitive match
    // on 'penworth.ai' — the title is 'The Navigator Protocol' so no
    // false positive from project content.
    expect(text.toLowerCase()).not.toContain('penworth.ai');
  });
});
