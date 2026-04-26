/**
 * Penworth Guild Foundations certificate PDF builder.
 *
 * Layout: A4 landscape, gold accent border, Penworth wordmark top-centre,
 * member display name large in a serif face, completion date, founder
 * signature image (Allura-rendered "Nawras Alali"), unique code printed
 * with verification URL at the bottom.
 *
 * Returns a single PDF Buffer. Caller is responsible for uploading to
 * Supabase Storage and persisting the row.
 */

import path from 'path';
import { promises as fs } from 'fs';
import type PDFDocument from 'pdfkit';

type PDFKitDoc = InstanceType<typeof PDFDocument>;

export interface CertificateInputs {
  /** Display name on the certificate, e.g. 'Nawras Alali' */
  displayName: string;
  /** Issue date, ISO string. We render the date portion only. */
  issuedAtIso: string;
  /** Code in PWG-XXXX-XXXX format */
  code: string;
  /** Public URL where the code can be verified, e.g. https://penworth.ai/verify/PWG-XXXX-XXXX */
  verifyUrl: string;
}

const SIGNATURE_PATH = path.join(process.cwd(), 'public', 'founder-signature.png');

const GOLD = '#BA7517';
const GOLD_DARK = '#854F0B';
const PAPER = '#FAEEDA';
const INK = '#0C111E';
const MUTED = '#5F5E5A';

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Build the certificate PDF and return its bytes.
 */
export async function buildCertificatePDF(inputs: CertificateInputs): Promise<Buffer> {
  const PDFDocumentCtor = (await import('pdfkit')).default;
  const doc: PDFKitDoc = new PDFDocumentCtor({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: 'Penworth Guild Foundations Certificate',
      Subject: `Certificate ${inputs.code}`,
      Author: 'Penworth',
      Creator: 'Penworth Guild',
      Producer: 'Penworth',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // A4 landscape: 842 × 595 pt
  const W = 842;
  const H = 595;

  // Cream paper background
  doc.rect(0, 0, W, H).fill(PAPER);

  // Outer gold double-border
  const padOuter = 30;
  const padInner = 38;
  doc.lineWidth(2.5).strokeColor(GOLD).rect(padOuter, padOuter, W - 2 * padOuter, H - 2 * padOuter).stroke();
  doc.lineWidth(0.6).strokeColor(GOLD).rect(padInner, padInner, W - 2 * padInner, H - 2 * padInner).stroke();

  // Penworth wordmark (text — no font asset needed)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD_DARK)
    .text('PENWORTH', padOuter, 64, { width: W - 2 * padOuter, align: 'center', characterSpacing: 6 });

  // Title
  doc.font('Times-Italic').fontSize(28).fillColor(INK)
    .text('Certificate of Guild Foundations', padOuter, 110, { width: W - 2 * padOuter, align: 'center' });

  // Sub-line
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text('This certifies that', padOuter, 168, { width: W - 2 * padOuter, align: 'center' });

  // Display name — the visual focal point
  doc.font('Times-Bold').fontSize(40).fillColor(INK)
    .text(inputs.displayName, padOuter, 196, { width: W - 2 * padOuter, align: 'center' });

  // Body sentence
  doc.font('Helvetica').fontSize(12).fillColor(INK).lineGap(3)
    .text(
      'has completed the Penworth Guild Member Foundations programme, comprising Welcome to the Guild, ' +
        'Commission Mechanics, and Representing Penworth Well, and has met the conduct and competency ' +
        'standards of a Penworth Guildmember.',
      padOuter + 60, 270,
      { width: W - 2 * padOuter - 120, align: 'center' },
    );

  // Issued / valid block
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(
      `Issued ${formatLongDate(inputs.issuedAtIso)}    ·    Valid in perpetuity`,
      padOuter, 360,
      { width: W - 2 * padOuter, align: 'center' },
    );

  // Founder signature — image, then printed name + role line
  try {
    const sig = await fs.readFile(SIGNATURE_PATH);
    // Signature image: target ~140×24 pt area, centred horizontally
    const sigW = 160;
    const sigH = 28;
    const sigX = (W - sigW) / 2;
    const sigY = 410;
    doc.image(sig, sigX, sigY, { width: sigW, height: sigH });
  } catch {
    // Fallback: print "Nawras Alali" in italic serif if PNG unreachable
    doc.font('Times-Italic').fontSize(20).fillColor(INK)
      .text('Nawras Alali', padOuter, 412, { width: W - 2 * padOuter, align: 'center' });
  }

  // Hairline under signature
  doc.lineWidth(0.4).strokeColor(MUTED)
    .moveTo(W / 2 - 80, 446).lineTo(W / 2 + 80, 446).stroke();

  // Founder credit
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
    .text('Nawras Alali', padOuter, 452, { width: W - 2 * padOuter, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('Founder, Penworth', padOuter, 466, { width: W - 2 * padOuter, align: 'center' });

  // Code + verify URL footer
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Certificate ID: ${inputs.code}`, padOuter, H - 70, { width: W - 2 * padOuter, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(GOLD_DARK)
    .text(`Verify at ${inputs.verifyUrl}`, padOuter, H - 56, { width: W - 2 * padOuter, align: 'center', link: inputs.verifyUrl });

  doc.end();

  // Wait for the stream to finish flushing
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}
