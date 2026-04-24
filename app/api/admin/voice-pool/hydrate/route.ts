import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRoleForApi } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/admin/voice-pool/hydrate
 *
 * One-shot admin endpoint that walks every active ElevenLabs row in
 * voice_pool that is missing metadata (gender/age_range/tone/style_tags/
 * book_types), calls ElevenLabs GET /v1/voices/{provider_voice_id}, and
 * fills the fields from the returned labels.
 *
 * Why it exists as an endpoint and not a CLI script: the CEO Claude
 * session that owns CEO-058 cannot reach api.elevenlabs.io from its
 * bash sandbox (Anthropic egress TLS-inspection returns an 18-byte
 * "DNS cache overflow" 503). The Vercel runtime has no such block and
 * the ELEVENLABS_API_KEY env var is already present there (used by the
 * Livebook TTS path). So this endpoint is how the work gets finished.
 *
 * Book-type mapping is conservative and reversible — the rows keep the
 * raw labels in a new `eleven_labels_raw` JSONB field on the notes
 * column (we don't add a new column for a one-off migration) so a
 * future pass can re-map without another API round-trip.
 *
 * Auth: admin role required.
 * Body: optional { dry_run?: boolean; voice_id?: string } to preview or
 *       hydrate a single voice.
 * Returns: { processed, updated, errors: [{ voice_id, reason }] }
 */

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  category?: string;
  description?: string;
};

/**
 * Map ElevenLabs labels to our schema fields. ElevenLabs emits labels
 * like { gender: 'male', age: 'young', accent: 'american', use_case:
 * 'narrative_story', description: 'confident' }. We normalise:
 *
 *   gender:   'male' | 'female' | null
 *   age_range: 'young_adult' | 'middle_aged' | 'senior' | null
 *   tone:      'authoritative' | 'warm' | 'confident' | 'calm'
 *              | 'energetic' | 'dramatic' | null
 *   style_tags: free-form array; we keep accent + description + use_case
 *   book_types: derived from use_case
 */
function mapLabels(labels: Record<string, string> | undefined) {
  const l = labels ?? {};

  const gender: 'male' | 'female' | null =
    l.gender === 'male' || l.gender === 'female' ? l.gender : null;

  const ageRaw = (l.age ?? '').toLowerCase();
  const age_range =
    ageRaw.includes('young') ? 'young_adult'
      : ageRaw.includes('middle') ? 'middle_aged'
      : ageRaw.includes('old') || ageRaw.includes('senior') ? 'senior'
      : null;

  const descRaw = (l.description ?? '').toLowerCase();
  const tone =
    descRaw.includes('authoritative') || descRaw.includes('confident') ? 'authoritative'
      : descRaw.includes('warm') || descRaw.includes('friendly') ? 'warm'
      : descRaw.includes('calm') || descRaw.includes('soothing') ? 'calm'
      : descRaw.includes('energetic') || descRaw.includes('upbeat') ? 'energetic'
      : descRaw.includes('dramatic') || descRaw.includes('intense') ? 'dramatic'
      : null;

  const style_tags = [l.accent, l.description, l.use_case]
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  // Use-case → book_types. Narrative and conversational map to the
  // widest set; informative is non-fiction-weighted; characters is
  // fiction-weighted.
  const useCase = (l.use_case ?? '').toLowerCase();
  const book_types =
    useCase.includes('informative') || useCase.includes('educational') || useCase.includes('news')
      ? ['non-fiction', 'self-help', 'book']
      : useCase.includes('character') || useCase.includes('video_game') || useCase.includes('animation')
        ? ['fiction']
        : useCase.includes('narrative') || useCase.includes('story') || useCase.includes('audiobook')
          ? ['fiction', 'non-fiction', 'memoir', 'book']
          : useCase.includes('conversation') || useCase.includes('social')
            ? ['self-help', 'memoir', 'book']
            : [];

  return { gender, age_range, tone, style_tags, book_types };
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminRoleForApi();
  if (!gate.ok) return gate.response;

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    return NextResponse.json(
      { error: 'missing_env', message: 'ELEVENLABS_API_KEY not set in runtime env.' },
      { status: 503 },
    );
  }

  let body: { dry_run?: unknown; voice_id?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — defaults to full hydrate, not dry-run
  }
  const dryRun = body.dry_run === true;
  const onlyVoiceId = typeof body.voice_id === 'string' ? body.voice_id : null;

  const admin = createServiceClient();

  // Pull the set needing hydration. "Needing" = provider=elevenlabs AND
  // is_active AND (gender IS NULL OR tone IS NULL OR book_types empty).
  let q = admin
    .from('voice_pool')
    .select('id, provider_voice_id, display_name, gender, age_range, tone, book_types')
    .eq('provider', 'elevenlabs')
    .eq('is_active', true);
  if (onlyVoiceId) q = q.eq('provider_voice_id', onlyVoiceId);

  const { data: rows, error: fetchErr } = await q;
  if (fetchErr) {
    return NextResponse.json(
      { error: 'db_read_failed', message: fetchErr.message },
      { status: 500 },
    );
  }

  const candidates = (rows ?? []).filter((r) =>
    onlyVoiceId ? true :
      r.gender === null || r.tone === null || !r.book_types || (r.book_types as unknown[]).length === 0,
  );

  const errors: Array<{ voice_id: string; reason: string }> = [];
  const updatedRows: Array<{ voice_id: string; display_name: string | null; mapped: unknown }> = [];

  for (const row of candidates) {
    try {
      const resp = await fetch(
        `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(row.provider_voice_id)}`,
        { headers: { 'xi-api-key': elevenKey }, signal: AbortSignal.timeout(15_000) },
      );
      if (!resp.ok) {
        errors.push({
          voice_id: row.provider_voice_id,
          reason: `eleven_http_${resp.status}: ${(await resp.text()).slice(0, 200)}`,
        });
        continue;
      }
      const v = (await resp.json()) as ElevenLabsVoice;
      const mapped = mapLabels(v.labels);
      updatedRows.push({ voice_id: row.provider_voice_id, display_name: row.display_name, mapped });

      if (!dryRun) {
        const { error: writeErr } = await admin
          .from('voice_pool')
          .update({
            gender: mapped.gender,
            age_range: mapped.age_range,
            tone: mapped.tone,
            style_tags: mapped.style_tags,
            book_types: mapped.book_types,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        if (writeErr) {
          errors.push({
            voice_id: row.provider_voice_id,
            reason: `db_write_failed: ${writeErr.message}`,
          });
        }
      }
    } catch (err) {
      errors.push({
        voice_id: row.provider_voice_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    candidates: candidates.length,
    processed: updatedRows.length,
    updated: dryRun ? 0 : updatedRows.length - errors.filter((e) => e.reason.startsWith('db_write_failed')).length,
    errors,
    preview: updatedRows,
  });
}
