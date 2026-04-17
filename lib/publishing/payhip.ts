import type { StoredOAuthToken } from './oauth-providers';
import type { PublishingMetadata } from './metadata';

/**
 * Payhip publish adapter.
 *
 * Payhip's API uses a long-lived API key in the `payhip-api-key` header
 * rather than OAuth. We store the key in the same encrypted credentials
 * table under auth_type='api_key', and shove the key into the `access_token`
 * field of StoredOAuthToken for interface consistency with D2D/Gumroad.
 *
 * Flow:
 *   1. POST /v2/product — create the product (name, price, description, file)
 *      Payhip accepts the download file inline in the same multipart create.
 *   2. POST /v2/product/image — attach the cover image (by product_link)
 *   3. Product is published immediately on create.
 */

const PAYHIP_API = 'https://payhip.com/api/v2';

export interface PayhipPublishResult {
  productLink: string;        // payhip slug, e.g. "aBc12"
  productUrl: string;         // full https URL
  rawResponse: unknown;
}

export async function publishToPayhip(args: {
  token: StoredOAuthToken;    // access_token holds the API key
  metadata: PublishingMetadata;
  manuscriptBuffer: Buffer;
  manuscriptFilename: string;
  coverBuffer?: Buffer | null;
}): Promise<PayhipPublishResult> {
  const { token, metadata, manuscriptBuffer, manuscriptFilename, coverBuffer } = args;
  const apiKey = token.access_token;

  // --- Step 1: create product with file ---
  const form = new FormData();
  form.append('name', metadata.title);
  form.append(
    'description',
    metadata.long_description || metadata.short_description || '',
  );
  form.append(
    'price',
    metadata.is_free ? '0' : String(Math.max(0, metadata.price_usd || 2.99)),
  );
  form.append('currency', (metadata.currency || 'USD').toUpperCase());
  form.append('product_type', 'digital');
  form.append(
    'file',
    new Blob([new Uint8Array(manuscriptBuffer)], {
      type: manuscriptFilename.endsWith('.epub')
        ? 'application/epub+zip'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    manuscriptFilename,
  );

  const createResp = await fetch(`${PAYHIP_API}/product`, {
    method: 'POST',
    headers: { 'payhip-api-key': apiKey, Accept: 'application/json' },
    body: form,
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => '');
    throw new PayhipError(
      `Product creation failed (${createResp.status})`,
      text.slice(0, 400),
    );
  }

  const createBody = (await createResp.json()) as {
    success?: boolean;
    data?: { product_link?: string; permalink?: string };
    message?: string;
  };

  const productLink = createBody.data?.product_link || createBody.data?.permalink;
  if (!productLink) {
    throw new PayhipError(
      'Product creation returned no product_link',
      createBody.message || JSON.stringify(createBody).slice(0, 400),
    );
  }

  // --- Step 2: upload cover (non-fatal) ---
  if (coverBuffer) {
    try {
      const coverForm = new FormData();
      coverForm.append('product_link', productLink);
      coverForm.append(
        'image',
        new Blob([new Uint8Array(coverBuffer)], { type: 'image/jpeg' }),
        'cover.jpg',
      );
      await fetch(`${PAYHIP_API}/product/image`, {
        method: 'POST',
        headers: { 'payhip-api-key': apiKey, Accept: 'application/json' },
        body: coverForm,
      });
    } catch (err) {
      console.warn('Payhip cover upload failed (non-fatal):', err);
    }
  }

  return {
    productLink,
    productUrl: `https://payhip.com/b/${productLink}`,
    rawResponse: createBody,
  };
}

export class PayhipError extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
    this.name = 'PayhipError';
  }
}
