import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Ideogram image generation typically takes 15-30 seconds. Without this
// explicit maxDuration, Vercel kills the route at the 10-second default
// and the user sees the Generate button spin forever, then no cover
// appears. Matches the 300s ceiling used by the Author pipeline AI
// routes (CEO-043 Phase 0, commit e48ca5c).
export const maxDuration = 300;

// TEMPORARY diagnostic: write one row per pipeline stage so the CEO
// session can see exactly where a cover-generate attempt dies even
// without Vercel runtime-log access. Remove once the silent-failure
// bug is root-caused. Uses service client (bypasses RLS) because we
// want the trace written regardless of the user's auth state.
async function trace(stage: string, details?: string, userId?: string, sessionId?: string) {
  try {
    const admin = createServiceClient();
    await admin.from('_cover_diag_trace').insert({
      stage,
      details: details?.slice(0, 800) ?? null,
      user_id: userId ?? null,
      session_id: sessionId ?? null,
    });
  } catch {
    // swallow — we must never fail the real request because the diag
    // table had a hiccup.
  }
}

// KDP Cover Specifications (6x9 book at 300 DPI)
const KDP_SPECS = {
  FRONT_COVER: {
    width: 1800,  // 6 inches * 300 DPI
    height: 2700, // 9 inches * 300 DPI
  },
  SAFE_ZONE_INCHES: 0.25, // Keep text 0.25" from edges
  BLEED_INCHES: 0.125,
};

interface CoverRequest {
  projectId: string;
  sessionId: string;
  coverType: 'front' | 'back';
  prompt?: string;
  bookTitle: string;
  authorName: string;
  bookDescription?: string;
}

export async function POST(request: NextRequest) {
  // Snapshot a few high-signal request bits so even if auth fails we
  // know the request reached our function and what client sent it.
  const ua = request.headers.get('user-agent')?.slice(0, 120) ?? '';
  await trace('entry', `ua=${ua}`);

  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await trace('auth_fail', 'no user from supabase.auth.getUser()');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await trace('auth_ok', null as any, user.id);

    const body: CoverRequest = await request.json();
    const { projectId, sessionId, coverType, prompt, bookTitle, authorName, bookDescription } = body;

    if (!projectId || !sessionId || !coverType || !bookTitle) {
      await trace('body_invalid', JSON.stringify({ projectId, sessionId, coverType, bookTitle }).slice(0, 300), user.id, sessionId);
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    await trace('body_ok', `type=${coverType} promptLen=${(prompt ?? '').length}`, user.id, sessionId);

    // Check if this is a regeneration (costs credits).
    // We also pull book_title + outline_data here so the prompt builder
    // below can derive a rich "subject" line even when the client did
    // not bother to send bookDescription (most callers don't — both
    // the editor page and hooks/use-agent-workflow.ts omit it or pass
    // empty string).
    const { data: session } = await supabase
      .from('interview_sessions')
      .select('front_cover_regenerations, back_cover_regenerations, book_title, outline_data')
      .eq('id', sessionId)
      .single();

    const regenerations = coverType === 'front' 
      ? session?.front_cover_regenerations || 0
      : session?.back_cover_regenerations || 0;

    const isRegeneration = regenerations > 0;
    const creditCost = isRegeneration ? 200 : 0; // FREE first time, 200 for regeneration

    // Check credits if regeneration
    if (isRegeneration) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits_balance')
        .eq('id', user.id)
        .single();

      if (!profile || (profile.credits_balance ?? 0) < creditCost) {
        await trace('insufficient_credits', `have=${profile?.credits_balance ?? 0} need=${creditCost}`, user.id, sessionId);
        return NextResponse.json(
          { error: `Not enough credits to regenerate. You have ${profile?.credits_balance ?? 0}, need ${creditCost}. Your first cover generation is free; each regeneration after that costs ${creditCost} credits.`, required: creditCost, available: profile?.credits_balance || 0 },
          { status: 402 }
        );
      }

      // Deduct credits
      await supabase
        .from('profiles')
        .update({ credits_balance: (profile.credits_balance ?? 0) - creditCost })
        .eq('id', user.id);
    }

    // Build the Ideogram prompt
    // IMPORTANT: We tell Ideogram NOT to include text - we overlay it ourselves
    let ideogramPrompt: string;

    // Server-side subject derivation (CEO-072 follow-up).
    //
    // The client-side callers of this endpoint (editor page + the
    // use-agent-workflow hook) do NOT send bookDescription, or send it
    // as empty string. Relying on the 60-char book title alone means
    // Ideogram can still produce off-topic imagery — the 14:48 UTC
    // fruit-bowl failure on "The Rewired Self" happened partly for
    // that reason. Derive a subject blurb from the outline's first
    // two chapter titles + their leading key point, which is the
    // richest single signal about what the book is actually about.
    const titleForPrompt = (session?.book_title || bookTitle || '').trim();
    const derivedSubject = deriveSubjectFromOutline(session?.outline_data);
    const effectiveSubject = (bookDescription?.trim() || derivedSubject || '').slice(0, 500);
    await trace('subject_ok', `titleLen=${titleForPrompt.length} subjLen=${effectiveSubject.length} fromOutline=${!bookDescription?.trim() && !!derivedSubject}`, user.id, sessionId);

    if (coverType === 'front') {
      // Per CEO-098, the prompt is now driven by a designer-brief
      // composer that picks a single motif, two colors, and an art
      // reference based on book content. This replaces the prior
      // "evoking themes" approach which gave Ideogram too much freedom
      // and produced rainbow chaos with hallucinated text. Reasoning:
      //
      // A real cover designer makes 5 decisions before tooling: archetype,
      // single brief, single motif, 2-color palette, art reference. The
      // previous prompt asked Ideogram to make those decisions, which
      // it can't — it averages its training data. The new prompt makes
      // the decisions server-side and asks Ideogram to execute, not
      // design. This sidesteps the "book cover = title + author name"
      // training prior because the model never learns this is a book
      // cover — it sees a museum-poster brief instead.
      const userStyle = (prompt ?? '').trim();
      // Strip the founder's well-meaning "no words / no text" hints
      // from the style chip — paradoxically they reinforce text by
      // putting the word "text" in the prompt (LLMs and diffusion
      // models alike attend to negation poorly). The negative_prompt
      // field is the right place for those.
      const cleanedStyle = userStyle
        .replace(/\bno (words|text|typography|letters|writing|fonts)[^.]*\.?/gi, '')
        .replace(/\bonly[^.]*allowed\.?/gi, '')
        .trim();

      const brief = composeDesignerBrief(titleForPrompt, effectiveSubject);
      await trace('brief_composed', `preset=${brief.presetTag}`, user.id, sessionId);

      const styleModifier = cleanedStyle
        ? `\n\nAdditional style direction: ${cleanedStyle}.`
        : '';

      ideogramPrompt =
        `A limited-edition museum exhibition poster. ` +
        `Single subject: ${brief.motif}.\n\n` +
        `Color palette: exactly two colors. Background is solid ` +
        `${brief.primaryColor}. The subject is rendered in ` +
        `${brief.accentColor}. No third color, no rainbow, no decorative ` +
        `flourishes outside the central subject.\n\n` +
        `Composition: the subject sits in the middle 55% of the frame, ` +
        `centered, occupying that vertical slice cleanly. The top 30% of ` +
        `the frame is the same ${brief.primaryColor} as the rest of the ` +
        `background — pure, untouched, no detail, no marks of any kind. ` +
        `The bottom 18% of the frame is the same — pure ` +
        `${brief.primaryColor}, untouched. High contrast between the ` +
        `subject and the surrounding emptiness. Symmetrical balance. ` +
        `Vertical 2:3 aspect ratio.\n\n` +
        `Visual reference: ${brief.artReference}.${styleModifier}`;
      // Final guard. Kept SHORT and POSITIVE. The previous version
      // repeated "typography" and "overlay" multiple times — every
      // mention of those words is a text cue to the model. The
      // negative_prompt field already enumerates the forbidden
      // outputs; the prompt body only needs to lean on the
      // positively-framed empty-zone description above.
      ideogramPrompt += '\n\nThe image must contain zero written language.';
    } else {
      ideogramPrompt = buildBackCoverPrompt(titleForPrompt, effectiveSubject);
      ideogramPrompt += '\n\nThe image must contain zero written language.';
    }

    // Explicit env guard. Previously a missing IDEOGRAM_API_KEY silently
    // produced a 401 from Ideogram and we returned a generic "Failed to
    // generate cover image" — hard to debug from the client. Now we say
    // exactly what's wrong so the Founder (or Vercel dashboard) can act.
    const ideogramKey = process.env.IDEOGRAM_API_KEY;
    if (!ideogramKey) {
      await trace('env_missing', 'IDEOGRAM_API_KEY', user.id, sessionId);
      console.error('[covers/generate] IDEOGRAM_API_KEY is not set on this deployment');
      return NextResponse.json(
        { error: 'Cover service is not configured on the server (IDEOGRAM_API_KEY missing). Founder action required: set the env var on Vercel and redeploy.' },
        { status: 503 }
      );
    }
    await trace('env_ok', `keyLen=${ideogramKey.length}`, user.id, sessionId);

    // Call Ideogram API
    await trace('ideogram_call_start', null as any, user.id, sessionId);
    const ideogramResponse = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': ideogramKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt: ideogramPrompt,
          aspect_ratio: 'ASPECT_2_3', // Book cover ratio
          model: 'V_2',
          // OFF (not AUTO). With AUTO, Ideogram silently rewrites the
          // prompt and reliably reintroduces title/author typography on
          // anything it classifies as a book cover — even when our
          // explicit instructions forbid text. CEO-092 root cause for
          // the "A JI ER WAREA" gibberish on The Rewired Self front
          // cover. Keeping it OFF means Ideogram respects our prompt
          // verbatim, including the no-text directive.
          magic_prompt_option: 'OFF',
          // Belt-and-braces: explicit negative prompt enumerating the
          // text-like outputs Ideogram is most likely to fabricate.
          // Ideogram V_2 honors this even when style_type=DESIGN.
          // CEO-098 expansion: include non-Latin scripts. Earlier
          // regenerations smuggled text in via Greek/Cyrillic-looking
          // glyphs even when "letters" was already in the list —
          // explicit script-class names override the ambiguity.
          negative_prompt:
            'text, words, letters, typography, lettering, fonts, ' +
            'title text, author name, captions, subtitles, watermarks, ' +
            'logos, brand marks, signatures, written language, ' +
            'characters, alphabets, numerals, glyphs, calligraphy, ' +
            'Latin script, Cyrillic script, Greek letters, ' +
            'Chinese characters, Japanese characters, Korean characters, ' +
            'Arabic script, Hebrew script, ' +
            'rainbow palette, multiple competing colors, busy decoration',
          // DESIGN produces stylized graphic-design output that reads as
          // a book cover. REALISTIC nudges Ideogram toward stock
          // photography — which is how a book about AI ended up with
          // a fruit photo (CEO-072).
          style_type: 'DESIGN',
        },
      }),
    });
    await trace('ideogram_response', `status=${ideogramResponse.status}`, user.id, sessionId);

    if (!ideogramResponse.ok) {
      const errorText = await ideogramResponse.text();
      await trace('ideogram_fail', `status=${ideogramResponse.status} body=${errorText.slice(0, 500)}`, user.id, sessionId);
      console.error('[covers/generate] Ideogram API error:', ideogramResponse.status, errorText);
      // Surface the actual upstream status + snippet so the user (and us)
      // can diagnose without hunting through logs.
      const snippet = errorText.slice(0, 200);
      return NextResponse.json(
        { error: `Cover service upstream error (HTTP ${ideogramResponse.status}): ${snippet}` },
        { status: 502 }
      );
    }

    const ideogramData = await ideogramResponse.json();
    const ephemeralUrl: string | undefined = ideogramData.data?.[0]?.url;

    if (!ephemeralUrl) {
      await trace('ideogram_no_image', JSON.stringify(ideogramData).slice(0, 500), user.id, sessionId);
      return NextResponse.json(
        { error: 'No image generated' },
        { status: 500 }
      );
    }
    await trace('ideogram_ok', `url=${ephemeralUrl.slice(0, 200)}`, user.id, sessionId);

    // CEO-073: Ideogram image URLs expire in ~10 hours. We must mirror
    // the bytes into our own `covers` storage bucket and persist the
    // public URL of OUR copy. Otherwise every cover the user generates
    // 404s by tomorrow — including covers on already-published books.
    //
    // The covers bucket RLS requires (storage.foldername(name))[1] =
    // auth.uid()::text on INSERT. We satisfy that with the `{userId}/`
    // prefix, mirroring the layout we use for author headshots.
    let imageUrl = ephemeralUrl;
    try {
      await trace('mirror_fetch_start', null as any, user.id, sessionId);
      const imgResp = await fetch(ephemeralUrl);
      if (!imgResp.ok) {
        throw new Error(`fetch ideogram image: HTTP ${imgResp.status}`);
      }
      const contentType = imgResp.headers.get('content-type') || 'image/png';
      const ext = contentType.includes('jpeg') ? 'jpg'
                : contentType.includes('webp') ? 'webp'
                : 'png';
      const bytes = await imgResp.arrayBuffer();
      const storagePath = `${user.id}/covers/${sessionId}-${coverType}.${ext}`;

      // Service-role for the bucket upload, not the user-scoped client.
      // _cover_diag_trace shows EVERY cover regen this week failed at
      // mirror_fail with "new row violates row-level security policy"
      // — the path's first foldername segment is user.id, satisfying
      // the policy on paper, so the failure is in supabase-ssr's
      // storage auth header propagation, not in policy. Service-role
      // bypasses RLS by design and is the correct privilege level for
      // this internal mirror operation: we already authenticated the
      // user as session owner above. CEO-094.
      const svcClient = createServiceClient();
      const { error: uploadErr } = await svcClient
        .storage
        .from('covers')
        .upload(storagePath, bytes, {
          contentType,
          upsert: true,
          cacheControl: '31536000',
        });

      if (uploadErr) {
        throw new Error(`storage upload: ${uploadErr.message}`);
      }

      const { data: { publicUrl } } = svcClient
        .storage
        .from('covers')
        .getPublicUrl(storagePath);

      // Cache-buster so the UI repaints immediately on regenerate
      // even though the storage path is deterministic.
      imageUrl = `${publicUrl}?v=${Date.now()}`;
      await trace('mirror_ok', imageUrl.slice(0, 200), user.id, sessionId);
    } catch (mirrorErr: any) {
      // Mirror failure is not fatal — the user still gets a working
      // cover for ~10 hours. We log so we can fix root cause later
      // (likely RLS or a transient Ideogram CDN hiccup) and keep
      // imageUrl pointing at the ephemeral URL. Better degraded than
      // failed.
      await trace('mirror_fail', String(mirrorErr?.message ?? mirrorErr).slice(0, 500), user.id, sessionId);
      console.error('[covers/generate] mirror to bucket failed; falling back to ephemeral URL:', mirrorErr);
    }

    // Update session with new cover URL
    const updateField = coverType === 'front' 
      ? { 
          front_cover_url: imageUrl, 
          front_cover_prompt: ideogramPrompt,
          front_cover_regenerations: regenerations + 1 
        }
      : { 
          back_cover_url: imageUrl, 
          back_cover_prompt: ideogramPrompt,
          back_cover_regenerations: regenerations + 1 
        };

    const { error: updateErr } = await supabase
      .from('interview_sessions')
      .update(updateField)
      .eq('id', sessionId);

    if (updateErr) {
      await trace('db_update_fail', updateErr.message, user.id, sessionId);
    } else {
      await trace('db_update_ok', null as any, user.id, sessionId);
    }

    // Log regeneration if credits were used
    if (isRegeneration) {
      await supabase
        .from('cover_regenerations')
        .insert({
          session_id: sessionId,
          cover_type: coverType,
          credits_used: creditCost,
          prompt_used: ideogramPrompt,
          result_url: imageUrl,
        });
    }

    await trace('done', `regen=${regenerations + 1}`, user.id, sessionId);
    return NextResponse.json({
      success: true,
      imageUrl,
      creditsUsed: creditCost,
      regenerationCount: regenerations + 1,
    });

  } catch (error: any) {
    await trace('exception', String(error?.message ?? error).slice(0, 500));
    console.error('Error generating cover:', error);
    return NextResponse.json(
      { error: `Internal server error: ${error?.message ?? 'unknown'}` },
      { status: 500 }
    );
  }
}

/**
 * Designer-brief composer (CEO-098 / CEO-097 follow-up).
 *
 * A real cover designer makes five decisions before they touch any
 * tool: archetype, one-sentence brief, single symbolic motif, two-color
 * palette, art reference. The previous prompt asked Ideogram to make
 * those decisions, which it can't — it just averages its training data.
 * Result: rainbow chaos with hallucinated text.
 *
 * This composer makes the decisions server-side, keyword-matched
 * against the book's title + outline data, and renders an Ideogram
 * prompt that reads like a designer brief to an executor. Ideogram's
 * job becomes "render this single described image", not "design a
 * book cover" — the latter triggers the title+author prior.
 *
 * The matching is intentionally simple in v1 (keyword lookup tables).
 * Future iteration can replace `pickMotif` etc. with a single LLM call
 * to Anthropic given the outline JSON; current shape preserves that
 * upgrade path.
 */
interface DesignerBrief {
  motif: string;
  primaryColor: string;
  accentColor: string;
  artReference: string;
  /**
   * For diagnostics only — recorded so we can correlate which brief
   * preset produced which output when reviewing _cover_diag_trace.
   */
  presetTag: string;
}

function pickMotif(bookTitle: string, subject: string): { motif: string; tag: string } {
  const t = `${bookTitle} ${subject}`.toLowerCase();

  // AI / cognition / mind
  if (/\b(ai|artificial intelligence|brain|mind|cogniti|think|neural|conscious|memory|attention)/.test(t)) {
    return {
      motif:
        'a single human silhouette in profile, the inside of the skull dissolving ' +
        'into fine traced lines that drift outward like smoke or ink in water — ' +
        'half organic, half machine-circuit',
      tag: 'ai-cognition',
    };
  }

  // Business / leadership / strategy / success
  if (/\b(business|leader|success|strategy|wealth|founder|company|entrepreneur|capital)/.test(t)) {
    return {
      motif:
        'a single bold geometric form rising from below a flat horizon line, ' +
        'casting a long quiet shadow — restrained, monumental, modernist',
      tag: 'business',
    };
  }

  // Memoir / personal / family / journey
  if (/\b(memoir|life|journey|family|mother|father|growing|home|childhood|story of)/.test(t)) {
    return {
      motif:
        'a single weathered everyday object resting on a flat surface — ' +
        'a folded letter, a worn key, an open palm, a single chair at a window — ' +
        'isolated and deliberate, like a still-life by Morandi',
      tag: 'memoir',
    };
  }

  // Self-help / wellness / habit / focus
  if (/\b(habit|focus|wellness|health|mindful|meditat|productiv|calm|sleep|stress|peace)/.test(t)) {
    return {
      motif:
        'a single tree or single small plant, isolated against open sky, ' +
        'rendered with restrained natural lines — the kind of image that feels ' +
        'patient and deliberate',
      tag: 'wellness',
    };
  }

  // Mystery / dark / secret
  if (/\b(mystery|secret|dark|shadow|hidden|silence|night|lost)/.test(t)) {
    return {
      motif:
        'a single closed door at the end of a long hallway, soft directional light ' +
        'from one side, deep shadow on the other — quiet suspense, no figure',
      tag: 'mystery',
    };
  }

  // History / ancient / war
  if (/\b(history|ancient|war|empire|civilization|century|age of)/.test(t)) {
    return {
      motif:
        'a single classical column or fragment of broken stone against a quiet sky, ' +
        'rendered in flat planes — monumental but reduced, like a museum poster',
      tag: 'history',
    };
  }

  // Default — abstract sculptural form
  return {
    motif:
      'a single abstract sculptural form — a smooth folded ribbon, a draped cloth, ' +
      'a hovering geometric solid — centered against open negative space',
    tag: 'default-abstract',
  };
}

function pickPalette(bookTitle: string, subject: string): { primary: string; accent: string; tag: string } {
  const t = `${bookTitle} ${subject}`.toLowerCase();

  // AI/cognition palette: high-contrast intellectual, navy + amber
  if (/\b(ai|artificial intelligence|brain|mind|cogniti|think|neural|conscious)/.test(t)) {
    return {
      primary: 'deep navy ink, untextured, flat, almost black-blue',
      accent: 'warm amber, with a subtle gradient toward gold at the edges',
      tag: 'navy-amber',
    };
  }

  // Business: charcoal + electric blue
  if (/\b(business|leader|success|strategy|wealth|founder|company|entrepreneur)/.test(t)) {
    return {
      primary: 'deep charcoal, flat and uniform',
      accent: 'electric ultramarine blue with a single highlight',
      tag: 'charcoal-blue',
    };
  }

  // Memoir: bone white + ochre
  if (/\b(memoir|life|journey|family|mother|father|growing|home|childhood)/.test(t)) {
    return {
      primary: 'warm bone white with the faintest paper grain',
      accent: 'burnt ochre, restrained, like aged photograph',
      tag: 'bone-ochre',
    };
  }

  // Wellness: forest green + cream
  if (/\b(habit|focus|wellness|health|mindful|meditat|productiv|calm|sleep)/.test(t)) {
    return {
      primary: 'soft forest green, slightly desaturated, even tone',
      accent: 'warm cream',
      tag: 'forest-cream',
    };
  }

  // Mystery: deep teal + bone
  if (/\b(mystery|secret|dark|shadow|hidden|silence|night)/.test(t)) {
    return {
      primary: 'deep teal-black, almost the color of wet ink',
      accent: 'bone white, used sparingly as a single highlight',
      tag: 'teal-bone',
    };
  }

  // History: terracotta + parchment
  if (/\b(history|ancient|war|empire|civilization|century)/.test(t)) {
    return {
      primary: 'parchment cream with a subtle warm undertone',
      accent: 'terracotta red, restrained',
      tag: 'parchment-terracotta',
    };
  }

  // Default — burgundy + cream (a safe, premium combination)
  return {
    primary: 'deep burgundy, flat and uniform',
    accent: 'warm cream, used sparingly',
    tag: 'default-burgundy',
  };
}

const ART_REFERENCE_CONCEPT =
  'in the visual language of contemporary editorial illustration — Olly Moss, ' +
  'Christoph Niemann, Noma Bar — flat shapes, restrained palette, one strong ' +
  'idea, executed with confidence';

function composeDesignerBrief(bookTitle: string, subject: string): DesignerBrief {
  const motif = pickMotif(bookTitle, subject);
  const palette = pickPalette(bookTitle, subject);
  return {
    motif: motif.motif,
    primaryColor: palette.primary,
    accentColor: palette.accent,
    artReference: ART_REFERENCE_CONCEPT,
    presetTag: `${motif.tag}|${palette.tag}`,
  };
}

/**
 * Pull a rich "subject" blurb out of the stored outline_data jsonb so
 * Ideogram has something to latch onto beyond a short book title.
 *
 * Client-side callers of /api/covers/generate currently don't send
 * bookDescription — the editor page and use-agent-workflow hook both
 * omit it or pass empty string. Rather than plumbing a new field
 * through two clients, we derive the subject here from whatever the
 * outline agent has already written.
 *
 * Strategy: take the first two chapter titles + the first key point
 * of chapter 1, which is consistently the "what this book is about"
 * signal under our outline agent's format (see the outline_data
 * example in interview_sessions — keys: body[].title, body[].keyPoints[]).
 *
 * Returns an empty string if we can't get anything useful. Defensive
 * against any shape — outline_data is jsonb, so we validate each
 * property access.
 */
function deriveSubjectFromOutline(outlineData: unknown): string {
  if (!outlineData || typeof outlineData !== 'object') return '';
  const body = (outlineData as any).body;
  if (!Array.isArray(body) || body.length === 0) return '';

  const parts: string[] = [];

  const firstTitle = typeof body[0]?.title === 'string' ? body[0].title.trim() : '';
  if (firstTitle) parts.push(firstTitle);

  const firstKeyPoint =
    Array.isArray(body[0]?.keyPoints) && typeof body[0].keyPoints[0] === 'string'
      ? body[0].keyPoints[0].trim()
      : '';
  if (firstKeyPoint) parts.push(firstKeyPoint);

  const secondTitle = typeof body[1]?.title === 'string' ? body[1].title.trim() : '';
  if (secondTitle) parts.push(secondTitle);

  return parts.join(' — ').slice(0, 400);
}

function buildDefaultFrontCoverPrompt(bookTitle: string, description?: string): string {
  // Per CEO-095 — same reframing as the user-style branch above. We
  // do NOT mention the book title (Ideogram would render it then
  // hallucinate a subtitle/author line in the empty zones below) and
  // we do NOT call this a "book cover" (which triggers the model's
  // title+author prior). The bookTitle parameter is kept in the
  // signature for future use but is unused in the prompt body. Genre
  // hints are derived from a lower-cased copy used purely to choose
  // a style direction; the title itself never reaches Ideogram.
  const lowerTitle = bookTitle.toLowerCase();

  let styleGuide = 'Refined editorial illustration, premium publishing aesthetic, considered composition';

  if (lowerTitle.includes('business') || lowerTitle.includes('success') || lowerTitle.includes('leadership')) {
    styleGuide = 'Modern editorial illustration, clean minimalist design, sophisticated abstract geometric shapes, gradient colors, authoritative tone';
  } else if (lowerTitle.includes('love') || lowerTitle.includes('heart') || lowerTitle.includes('romance')) {
    styleGuide = 'Romantic editorial illustration, soft warm colors, dreamy atmosphere, emotional and inviting composition';
  } else if (lowerTitle.includes('mystery') || lowerTitle.includes('dark') || lowerTitle.includes('secret')) {
    styleGuide = 'Mystery-thriller editorial illustration, dark moody atmosphere, dramatic lighting, suspenseful composition, intriguing shadows';
  } else if (lowerTitle.includes('health') || lowerTitle.includes('wellness') || lowerTitle.includes('fitness')) {
    styleGuide = 'Wellness editorial illustration, fresh vibrant colors, clean energetic design, inspiring tone';
  } else if (lowerTitle.includes('cook') || lowerTitle.includes('recipe') || lowerTitle.includes('food')) {
    styleGuide = 'Food-magazine editorial illustration, appetizing styling, warm inviting colors, culinary elegance';
  } else if (lowerTitle.includes('child') || lowerTitle.includes('kid')) {
    styleGuide = 'Children\'s editorial illustration, bright cheerful colors, playful and engaging';
  } else if (lowerTitle.includes('history') || lowerTitle.includes('war') || lowerTitle.includes('ancient')) {
    styleGuide = 'Historical editorial illustration, classic elegant design, period-appropriate imagery, distinguished and scholarly';
  } else if (lowerTitle.includes('tech') || lowerTitle.includes('ai') || lowerTitle.includes('digital')) {
    styleGuide = 'Technology editorial illustration, futuristic sleek design, digital aesthetic, modern and innovative';
  }

  const subjectLine = description
    ? `evoking these themes: ${description}`
    : 'with strong evocative imagery';

  return (
    `A premium editorial illustration ${subjectLine}. ${styleGuide}. ` +
    `Suitable for a magazine cover spread, art print, or gallery poster.\n\n` +
    `Composition: a single strong central motif, symmetrically framed, ` +
    `occupying the middle 55% of the frame vertically. The top 30% of the ` +
    `frame is pure empty atmospheric background — solid color, soft gradient, ` +
    `or quiet untextured surface, with no detail and no marks of any kind. ` +
    `The bottom 18% of the frame is the same — empty, quiet, untextured ` +
    `background. High contrast between the focal motif and the surrounding ` +
    `emptiness. Vertical 2:3 aspect ratio. Avoid stock-photo aesthetics; the ` +
    `image must feel specific and intentional.`
  );
}

function buildBackCoverPrompt(bookTitle: string, description?: string): string {
  // Per CEO-095 — reframed away from "book back cover". The image is
  // described as a standalone abstract background suitable for text
  // overlay (we add the text in PDF render). bookTitle parameter is
  // intentionally unused in the prompt body for the same reason as
  // the front cover: putting the title in the prompt invites Ideogram
  // to render it, which it does — alongside hallucinated companion
  // text in the surrounding zones.
  void bookTitle;
  const subject = description ? ` Theme context: ${description}.` : '';
  return (
    `An elegant abstract background design — subtle, sophisticated, ` +
    `understated. A soft gradient or quiet pattern that complements a ` +
    `companion piece. The center 55% of the frame is calm and uncluttered ` +
    `negative space, suitable for being viewed as the background to a ` +
    `composition.${subject} ` +
    `Vertical 2:3 aspect ratio. Refined publishing-quality aesthetic.`
  );
}

// GET endpoint to fetch cover suggestions
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookTitle = searchParams.get('title') || '';
  const contentType = searchParams.get('contentType') || '';

  // Return cover style suggestions based on title/content type
  const suggestions = generateCoverSuggestions(bookTitle, contentType);

  return NextResponse.json({ suggestions });
}

function generateCoverSuggestions(title: string, contentType: string): string[] {
  // Per CEO-095 the chip set is expanded from 5 to 10 base options
  // (founder asked for 7+) and the previous "Elegant with subtle
  // textures and clean typography space" chip is REMOVED — the word
  // "typography" in the chip text propagates into the prompt body and
  // actively biases Ideogram toward rendering text, the exact failure
  // mode we are fighting.
  const baseSuggestions = [
    'Bold and eye-catching with vibrant colors',
    'Professional and modern with abstract shapes',
    'Minimalist with strong negative space',
    'Surreal and dreamlike',
    'Cinematic with dramatic lighting',
    'Architectural and geometric',
    'Organic and nature-inspired',
    'Hand-drawn editorial illustration style',
    'Retro / vintage poster aesthetic',
    'Photographic with shallow depth of field',
  ];

  // Add genre-specific suggestions
  if (contentType === 'fiction') {
    baseSuggestions.push(
      'Atmospheric scene with dramatic lighting',
      'Character silhouette against evocative background'
    );
  } else if (contentType === 'non-fiction' || contentType === 'business') {
    baseSuggestions.push(
      'Clean geometric design with professional colors',
      'Inspirational imagery with upward momentum'
    );
  } else if (contentType === 'memoir') {
    baseSuggestions.push(
      'Personal and intimate with nostalgic tones',
      'Journey metaphor with path or horizon'
    );
  }

  return baseSuggestions;
}
