import type { PublishingMetadata } from './metadata';

/**
 * Publish kits — platform-specific packets authors upload manually.
 * Each kit has:
 *   - steps   : ordered in-app instructions
 *   - fields  : copy-paste ready values
 *   - files   : which generated files to include in the download bundle
 *   - deepLink: where to start the upload
 *
 * All platforms here are EBOOK-ONLY on Penworth (we don't do paperback,
 * so there's never any ISBN requirement on this path).
 */

export interface PublishKitStep {
  number: number;
  title: string;
  detail: string;
}

export interface PublishKitField {
  label: string;
  value: string;
  maxChars?: number;
  note?: string;
}

export interface PublishKit {
  platformSlug: string;
  platformName: string;
  estimatedMinutes: number;
  deepLink: string;
  summary: string;
  steps: PublishKitStep[];
  fields: PublishKitField[];
  files: Array<{ name: string; format: 'epub' | 'pdf' | 'docx' | 'jpg' | 'csv'; description: string }>;
}

function baseFields(meta: PublishingMetadata): PublishKitField[] {
  return [
    { label: 'Title', value: meta.title, maxChars: 200 },
    { label: 'Subtitle', value: meta.subtitle || '' },
    { label: 'Author', value: meta.author_name },
    { label: 'Description', value: meta.long_description || meta.short_description || '' },
    { label: 'Keywords', value: meta.keywords.slice(0, 7).join(', '), note: 'Up to 7, comma-separated' },
    { label: 'Price (USD)', value: meta.is_free ? 'Free' : (meta.price_usd?.toFixed(2) || '9.99') },
    { label: 'Language', value: meta.language || 'en' },
  ];
}

// =============================================================================
// AMAZON KDP — Ebook only (no ISBN required, KDP generates ASIN automatically)
// =============================================================================
export function buildKDPKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'kdp',
    platformName: 'Amazon Kindle Direct Publishing',
    estimatedMinutes: 3,
    deepLink: 'https://kdp.amazon.com/en_US/title-setup/kindle/new/details',
    summary:
      'Publish your ebook to Amazon Kindle — the largest ebook marketplace globally. No ISBN required — KDP assigns a free ASIN. Royalties: 35% or 70% depending on price.',
    steps: [
      { number: 1, title: 'Sign in to KDP', detail: 'Go to kdp.amazon.com and log in (or create a free account — takes 2 minutes and requires your tax info).' },
      { number: 2, title: 'Start a new Kindle eBook', detail: 'Click "+ Create" → "Kindle eBook". KDP will ask for language first — set it to match your book.' },
      { number: 3, title: 'Paste the metadata', detail: 'Copy-paste the fields from this kit into KDP\'s form: title, subtitle (optional), author, description, keywords (up to 7), categories. No ISBN needed for ebook-only.' },
      { number: 4, title: 'Upload your manuscript + cover', detail: 'Upload the two files from this kit: the DOCX manuscript and the JPG cover. KDP will convert automatically.' },
      { number: 5, title: 'Set rights and pricing', detail: 'Select "I own the copyright". Choose 70% royalty tier (requires price between $2.99–$9.99). Set your territories to "Worldwide".' },
      { number: 6, title: 'Click Publish', detail: 'KDP reviews in 24–72 hours. You\'ll get an email when your book is live.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'manuscript.docx', format: 'docx', description: 'KDP-formatted manuscript' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover at 2560×1600px minimum' },
    ],
  };
}

// =============================================================================
// IngramSpark — Ebook-only track (no ISBN required for ebook tier)
// =============================================================================
export function buildIngramSparkKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'ingram_spark',
    platformName: 'IngramSpark',
    estimatedMinutes: 5,
    deepLink: 'https://myaccount.ingramspark.com/Portal/Title/New',
    summary:
      'Distribute to libraries and indie bookstores worldwide. IngramSpark reaches OverDrive (libraries), indie stores, and major online retailers. Ebook submission — no ISBN required (IngramSpark assigns one for ebook free-tier).',
    steps: [
      { number: 1, title: 'Sign in to IngramSpark', detail: 'Go to myaccount.ingramspark.com and log in. Account setup is free.' },
      { number: 2, title: 'Start a new title', detail: 'Click "Add a new title" → "Ebook only". This path skips the print fees entirely.' },
      { number: 3, title: 'Paste title information', detail: 'Copy-paste from this kit: title, subtitle, author, description, BISAC codes, keywords.' },
      { number: 4, title: 'Upload your EPUB', detail: 'Upload the EPUB file from this kit. IngramSpark validates it automatically.' },
      { number: 5, title: 'Set territorial rights', detail: 'Select "Worldwide Rights" unless you\'re limiting territories.' },
      { number: 6, title: 'Choose retailers + submit', detail: 'Select which retailers to distribute to (OverDrive recommended for libraries). Submit — review takes 2–5 business days.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'EPUB 3 formatted for IngramSpark' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover at 1400×2100px minimum' },
    ],
  };
}

// =============================================================================
// Barnes & Noble Press
// =============================================================================
export function buildBNKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'bn_press',
    platformName: 'Barnes & Noble Press',
    estimatedMinutes: 3,
    deepLink: 'https://press.barnesandnoble.com/',
    summary: 'Publish to the Barnes & Noble store and Nook readers. Royalties 40–65% depending on price band.',
    steps: [
      { number: 1, title: 'Sign in to B&N Press', detail: 'Go to press.barnesandnoble.com and log in (or register a free account).' },
      { number: 2, title: 'Create new ebook', detail: 'Click "Add Title" → "NOOK Book". Free to publish.' },
      { number: 3, title: 'Paste metadata', detail: 'Title, subtitle, author, description, keywords from this kit.' },
      { number: 4, title: 'Upload EPUB + cover', detail: 'Upload the EPUB and cover from this kit.' },
      { number: 5, title: 'Set price + territory + publish', detail: 'Use $2.99–$9.99 for 65% royalty tier. Territory: Worldwide.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'EPUB 3 for NOOK' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover at 1400×2100px' },
    ],
  };
}

// =============================================================================
// Apple Books (via Apple Books for Authors)
// =============================================================================
export function buildAppleKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'apple_books',
    platformName: 'Apple Books',
    estimatedMinutes: 4,
    deepLink: 'https://authors.apple.com/',
    summary: 'Apple Books global store — 50+ countries. Royalty: 70%. Apple assigns a free Apple ID for your ebook (no ISBN required).',
    steps: [
      { number: 1, title: 'Sign in to Apple Books for Authors', detail: 'Go to authors.apple.com. You\'ll need an Apple ID.' },
      { number: 2, title: 'Create new book', detail: 'Click "Add book". Choose "eBook" as format.' },
      { number: 3, title: 'Paste metadata', detail: 'Title, subtitle, author, description, primary + secondary categories.' },
      { number: 4, title: 'Upload EPUB + cover', detail: 'Upload the EPUB and cover. Apple validates on upload.' },
      { number: 5, title: 'Set pricing + publish', detail: 'Choose your price tier. Apple takes 30%. Territory defaults to all available countries.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'EPUB 3 validated against Apple\'s asset guidelines' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover at 1400×2100px minimum' },
    ],
  };
}

// =============================================================================
// Smashwords
// =============================================================================
export function buildSmashwordsKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'smashwords',
    platformName: 'Smashwords',
    estimatedMinutes: 4,
    deepLink: 'https://www.smashwords.com/upload',
    summary: 'Smashwords distributes to Apple, Kobo, B&N, libraries (OverDrive) — one upload fans out widely. Free to publish.',
    steps: [
      { number: 1, title: 'Create a free Smashwords account', detail: 'Go to smashwords.com and sign up.' },
      { number: 2, title: 'Start a new upload', detail: 'Click "Publish" → "Upload a new book".' },
      { number: 3, title: 'Paste metadata', detail: 'Title, subtitle, author, description, categories, tags from this kit.' },
      { number: 4, title: 'Upload EPUB', detail: 'Upload the EPUB file. Smashwords offers auto-conversion too but EPUB direct is cleaner.' },
      { number: 5, title: 'Publish to distribution channels', detail: 'Enable all retailer channels (Apple, Kobo, B&N, etc.) for maximum reach.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'Smashwords-compatible EPUB' },
      { name: 'cover.jpg', format: 'jpg', description: '1600×2400px recommended' },
    ],
  };
}

// =============================================================================
// Lulu (ebook)
// =============================================================================
export function buildLuluKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'lulu',
    platformName: 'Lulu',
    estimatedMinutes: 4,
    deepLink: 'https://www.lulu.com/create/ebook',
    summary: 'Distribute ebooks through Lulu bookstore + global retailers. 80% royalty on Lulu store sales.',
    steps: [
      { number: 1, title: 'Sign in to Lulu', detail: 'Go to lulu.com/create/ebook.' },
      { number: 2, title: 'Create ebook project', detail: 'Choose "Ebook" format.' },
      { number: 3, title: 'Paste title & description', detail: 'Copy from this kit.' },
      { number: 4, title: 'Upload EPUB + cover', detail: 'Lulu accepts EPUB 3. Cover must be JPG.' },
      { number: 5, title: 'Set price + publish', detail: 'Choose your list price. Lulu calculates royalty automatically.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'Lulu-compatible EPUB' },
      { name: 'cover.jpg', format: 'jpg', description: '1600×2560px recommended' },
    ],
  };
}

// =============================================================================
// BookBaby
// =============================================================================
export function buildBookBabyKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'bookbaby',
    platformName: 'BookBaby',
    estimatedMinutes: 5,
    deepLink: 'https://www.bookbaby.com/register',
    summary: 'Full-service ebook distribution to Amazon, Apple, B&N, Kobo, Google, Scribd. Upfront fee; 100% royalty to author.',
    steps: [
      { number: 1, title: 'Create a BookBaby account', detail: 'Go to bookbaby.com and register.' },
      { number: 2, title: 'Start ebook package', detail: 'Choose "Ebook Publishing" → fixed-price package.' },
      { number: 3, title: 'Paste metadata', detail: 'Title, author, description, BISAC categories.' },
      { number: 4, title: 'Upload files', detail: 'Upload EPUB + cover + DOCX backup.' },
      { number: 5, title: 'Submit for distribution', detail: 'BookBaby handles distribution to every major retailer. Live in 5–7 business days.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'EPUB 3' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover' },
      { name: 'manuscript.docx', format: 'docx', description: 'Source DOCX backup' },
    ],
  };
}

// =============================================================================
// Blurb
// =============================================================================
export function buildBlurbKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'blurb',
    platformName: 'Blurb',
    estimatedMinutes: 5,
    deepLink: 'https://www.blurb.com/create-ebook',
    summary: 'Premium ebook & photobook platform. Distributes to Blurb bookstore + Amazon + Apple.',
    steps: [
      { number: 1, title: 'Sign in to Blurb', detail: 'Go to blurb.com and log in.' },
      { number: 2, title: 'Create an ebook project', detail: 'Choose "Create an ebook".' },
      { number: 3, title: 'Paste metadata', detail: 'Title, author, description from this kit.' },
      { number: 4, title: 'Upload EPUB + cover', detail: 'Blurb accepts EPUB 3 + cover JPG.' },
      { number: 5, title: 'Publish', detail: 'Set your markup above Blurb\'s base cost.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'book.epub', format: 'epub', description: 'Blurb-ready EPUB' },
      { name: 'cover.jpg', format: 'jpg', description: 'Front cover' },
    ],
  };
}

// =============================================================================
// Wattpad (Paid Stories)
// =============================================================================
export function buildWattpadKit(meta: PublishingMetadata): PublishKit {
  return {
    platformSlug: 'wattpad',
    platformName: 'Wattpad Paid Stories',
    estimatedMinutes: 5,
    deepLink: 'https://creators.wattpad.com/',
    summary: 'Serialised paid-fiction audience. Best for fiction that benefits from chapter-by-chapter release.',
    steps: [
      { number: 1, title: 'Sign in to Wattpad', detail: 'Go to wattpad.com and log in (or sign up free).' },
      { number: 2, title: 'Create a story', detail: 'Click "Write" → "Create a new story". Paste title, description, cover.' },
      { number: 3, title: 'Paste each chapter', detail: 'Wattpad requires chapters pasted one at a time. Use the DOCX manuscript in this kit to copy chapter-by-chapter.' },
      { number: 4, title: 'Publish chapters', detail: 'Publish your first chapter. Schedule the rest weekly to build audience.' },
      { number: 5, title: 'Apply to Paid Stories', detail: 'Once you have 10K+ reads, apply at creators.wattpad.com.' },
    ],
    fields: baseFields(meta),
    files: [
      { name: 'manuscript.docx', format: 'docx', description: 'Full manuscript — copy chapter-by-chapter into Wattpad' },
      { name: 'cover.jpg', format: 'jpg', description: 'Story cover at 512×800px' },
    ],
  };
}

// =============================================================================
// Registry
// =============================================================================
export const KIT_BUILDERS: Record<string, (m: PublishingMetadata) => PublishKit> = {
  kdp: buildKDPKit,
  ingram_spark: buildIngramSparkKit,
  bn_press: buildBNKit,
  apple_books: buildAppleKit,
  smashwords: buildSmashwordsKit,
  lulu: buildLuluKit,
  bookbaby: buildBookBabyKit,
  blurb: buildBlurbKit,
  wattpad: buildWattpadKit,
};

export function getKitBuilder(slug: string) {
  return KIT_BUILDERS[slug] || null;
}
