// admin-import-showcase-images
// CEO-167 — One-shot importer for The New Rich showcase Livebook.
//
// Takes a list of {paragraph_idx, source_url, visual_prompt, excerpt} and:
//   1. Fetches each source_url (currently fal.ai CDN — TTL ~24h, must mirror)
//   2. Stores bytes to Supabase Storage at livebooks/{listing_id}/images/{slot}.jpg
//   3. Returns the array of public storage URLs and metadata
//
// The caller (CEO Claude via api.supabase.com Management endpoint) then
// inserts chapter_assets rows and updates the markdown — those steps are
// trivial DML and don't need an edge function.
//
// Why an edge function: sandbox cannot reach the project subdomain to upload
// to Storage REST. Edge functions run inside Supabase's network and can.
//
// SECRETS:
//   ADMIN_SECRET            x-admin-secret auth
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY auto-injected
//
// REQUEST
//   POST /functions/v1/admin-import-showcase-images
//   Headers: x-admin-secret: <ADMIN_SECRET>
//   Body: { listing_id: uuid, items: [{ paragraph_idx, source_url, visual_prompt, excerpt }] }
//
// RESPONSE
//   200: { ok: true, count, results: [{ paragraph_idx, storage_url, bytes }] }

import { createClient } from "jsr:@supabase/supabase-js@2";

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "livebooks";
const CONCURRENCY = 5;

interface Item {
  paragraph_idx: number;
  source_url: string;
  visual_prompt: string;
  excerpt: string;
}

interface ResultItem {
  paragraph_idx: number;
  storage_url: string | null;
  bytes: number;
  error: string | null;
}

async function fetchAndUpload(
  supa: ReturnType<typeof createClient>,
  listingId: string,
  item: Item,
): Promise<ResultItem> {
  try {
    // Fetch fal.ai image
    const r = await fetch(item.source_url);
    if (!r.ok) {
      return { paragraph_idx: item.paragraph_idx, storage_url: null, bytes: 0, error: `fetch ${r.status}` };
    }
    const buf = await r.arrayBuffer();
    const bytes = buf.byteLength;
    // Upload to Storage
    const key = `${listingId}/images/p${String(item.paragraph_idx).padStart(3, "0")}.jpg`;
    const { error: upErr } = await supa.storage
      .from(BUCKET)
      .upload(key, buf, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
    if (upErr) {
      return { paragraph_idx: item.paragraph_idx, storage_url: null, bytes, error: `upload: ${upErr.message}` };
    }
    const { data: urlData } = supa.storage.from(BUCKET).getPublicUrl(key);
    return { paragraph_idx: item.paragraph_idx, storage_url: urlData.publicUrl, bytes, error: null };
  } catch (e) {
    return { paragraph_idx: item.paragraph_idx, storage_url: null, bytes: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  const auth = req.headers.get("x-admin-secret");
  if (!auth || auth !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let body: { listing_id?: string; items?: Item[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }
  const listingId = body.listing_id;
  const items = body.items;
  if (!listingId || !Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: "missing_listing_id_or_items" }), { status: 400 });
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Bounded concurrency pool
  const queue = [...items];
  const results: ResultItem[] = [];
  const inflight = new Set<Promise<void>>();
  while (queue.length > 0 || inflight.size > 0) {
    while (inflight.size < CONCURRENCY && queue.length > 0) {
      const item = queue.shift()!;
      const p = fetchAndUpload(supa, listingId, item).then((r) => {
        results.push(r);
      });
      const wrapped = p.finally(() => inflight.delete(wrapped));
      inflight.add(wrapped);
    }
    if (inflight.size > 0) await Promise.race(inflight);
  }
  results.sort((a, b) => a.paragraph_idx - b.paragraph_idx);

  const okCount = results.filter((r) => r.storage_url).length;
  return new Response(
    JSON.stringify({ ok: true, count: items.length, ok_count: okCount, results }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
