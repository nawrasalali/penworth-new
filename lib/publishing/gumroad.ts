import type { StoredOAuthToken } from './oauth-providers';
import type { PublishingMetadata } from './metadata';

/**
 * Gumroad publish adapter.
 *
 * Gumroad's v2 API creates "products" that can hold downloadable files.
 * Unlike D2D (which is a distributor fanning out to 10+ retailers), Gumroad
 * is a direct-to-audience store — the author's product link goes straight
 * to their buyers with Gumroad's 10% platform fee on the first $1K tier.
 *
 * Flow:
 *   1. POST /v2/products — create the product with price + name + description
 *   2. POST /v2/products/{id}/files — upload the manuscript file
 *   3. PATCH /v2/products/{id} — publish it (published=true)
 *
 * Note: Gumroad's access token is used as a query/form param (access_token=...)
 * rather than as a Bearer header. We honor both — send it both ways so either
 * surface works. Their production endpoints accept the header form now.
 */

const GUMROAD_API = 'https://api.gumroad.com/v2';

export interface GumroadPublishResult {
  productId: string;
  shortUrl: string;
  rawResponse: unknown;
}

export async function publishToGumroad(args: {
  token: StoredOAuthToken;
  metadata: PublishingMetadata;
  manuscriptBuffer: Buffer;
  manuscriptFilename: string;
  coverBuffer?: Buffer | null;
}): Promise<GumroadPublishResult> {
  const { token, metadata, manuscriptBuffer, manuscriptFilename, coverBuffer } = args;
  const accessToken = token.access_token;

  // --- Step 1: create product ---
  const createForm = new FormData();
  createForm.append('access_token', accessToken);
  createForm.append('name', metadata.title);
  createForm.append(
    'description',
    metadata.long_description || metadata.short_description || '',
  );
  // Gumroad wants price in cents, integer. Free products pass price=0.
  const priceCents = metadata.is_free
    ? 0
    : Math.max(0, Math.round((metadata.price_usd || 2.99) * 100));
  createForm.append('price', String(priceCents));

  // Gumroad product types: "digital" for a file-download product
  createForm.append('product_type', 'digital');

  // Published=false initially; we flip it after file upload
  createForm.append('published', 'false');

  const createResp = await fetch(`${GUMROAD_API}/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body: createForm,
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => '');
    throw new GumroadError(
      `Product creation failed (${createResp.status})`,
      text.slice(0, 400),
    );
  }

  const createBody = (await createResp.json()) as {
    success?: boolean;
    product?: { id?: string; short_url?: string };
    message?: string;
  };

  if (!createBody.success || !createBody.product?.id) {
    throw new GumroadError(
      'Product creation response missing ID',
      createBody.message || JSON.stringify(createBody).slice(0, 400),
    );
  }

  const productId = createBody.product.id;
  const shortUrl = createBody.product.short_url || `https://gumroad.com/l/${productId}`;

  // --- Step 2: upload manuscript file ---
  const fileForm = new FormData();
  fileForm.append('access_token', accessToken);
  fileForm.append(
    'file',
    new Blob([new Uint8Array(manuscriptBuffer)], {
      type: manuscriptFilename.endsWith('.epub')
        ? 'application/epub+zip'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    manuscriptFilename,
  );

  const fileResp = await fetch(`${GUMROAD_API}/products/${productId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body: fileForm,
  });

  if (!fileResp.ok) {
    const text = await fileResp.text().catch(() => '');
    throw new GumroadError(
      `Manuscript upload failed (${fileResp.status})`,
      text.slice(0, 400),
    );
  }

  // --- Step 3: upload cover (non-fatal if it fails) ---
  if (coverBuffer) {
    try {
      const coverForm = new FormData();
      coverForm.append('access_token', accessToken);
      coverForm.append(
        'file',
        new Blob([new Uint8Array(coverBuffer)], { type: 'image/jpeg' }),
        'cover.jpg',
      );
      await fetch(`${GUMROAD_API}/products/${productId}/cover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        body: coverForm,
      });
    } catch (err) {
      console.warn('Gumroad cover upload failed (non-fatal):', err);
    }
  }

  // --- Step 4: publish the product ---
  const publishForm = new FormData();
  publishForm.append('access_token', accessToken);
  publishForm.append('published', 'true');

  const publishResp = await fetch(`${GUMROAD_API}/products/${productId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body: publishForm,
  });

  if (!publishResp.ok) {
    const text = await publishResp.text().catch(() => '');
    throw new GumroadError(
      `Publish flip failed (${publishResp.status})`,
      text.slice(0, 400),
    );
  }

  const publishBody = await publishResp.json().catch(() => ({}));

  return {
    productId,
    shortUrl,
    rawResponse: publishBody,
  };
}

export class GumroadError extends Error {
  constructor(message: string, public detail?: string) {
    super(message);
    this.name = 'GumroadError';
  }
}
