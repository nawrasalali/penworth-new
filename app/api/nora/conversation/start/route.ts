import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { buildNoraContext } from '@/lib/nora/context-builder';
import type { NoraSurface } from '@/lib/nora/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 2.5 Item 3 Commit 6 — POST /api/nora/conversation/start.
 *
 * Creates a new Nora conversation for the authenticated user. Returns
 * the conversation id + a surface-specific welcome message (sourced from
 * nora_kb_articles by slug, with an inline fallback if the KB row is
 * missing).
 *
 * Flow:
 *   1. Auth — user cookie session required
 *   2. Validate body.surface ∈ (author | guild | admin). Store surface
 *      out of scope this repo per A7.
 *   3. buildNoraContext — loads v_nora_member_context, derives role,
 *      applies mount guard. Terminated/resigned non-admins get 403.
 *   4. INSERT nora_conversations (surface, user_role, user_id)
 *   5. Fetch welcome KB article (slug = nora-welcome-${surface}). On
 *      miss, use a hardcoded fallback so /start NEVER fails due to a
 *      missing seed row.
 *   6. INSERT turn 0 as assistant with welcome content
 *   7. Return { conversation_id, welcome_message, context_summary }
 *
 * The turn API (`/api/nora/conversation/turn`) takes conversation_id
 * + user_message from this response and drives the actual Claude loop.
 */

const ALLOWED_SURFACES: NoraSurface[] = ['author', 'guild', 'admin'];

/**
 * Inline fallback welcome messages — used when no nora-welcome-${surface}
 * row exists in nora_kb_articles. Keeps /start resilient to missing KB
 * seeds. Admins can override via the KB editor whenever they want.
 */
const FALLBACK_WELCOME: Record<NoraSurface, string> = {
  author:
    "Hi, I'm Nora — support for your Penworth account. I can help with " +
    "billing, account issues, writing pipeline questions, or just explain " +
    "how something works. What's going on?",
  guild:
    "Hi, I'm Nora — Guild member support. Ask me about payouts, fraud " +
    "flags, referral tracking, academy modules, or anything else on the " +
    "Guild side. What can I help with?",
  store:
    "Hi, I'm Nora — Penworth Store support. I can help with orders, " +
    "author payouts, and general store questions.",
  admin:
    "Hi. I'm Nora in admin mode — I have access to runbooks and " +
    "cross-user tools. Ask me to diagnose, search, run reports, or " +
    "draft Tier 3 actions for review. What do you need?",
};

export async function POST(request: NextRequest) {
  // --- 1. Auth -------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // --- 2. Body validation --------------------------------------------------
  let body: { surface?: string };
  try {
    body = (await request.json()) as { surface?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const surfaceRaw = body.surface ?? 'author';
  if (!ALLOWED_SURFACES.includes(surfaceRaw as NoraSurface)) {
    return NextResponse.json(
      {
        error:
          `surface must be one of: ${ALLOWED_SURFACES.join(', ')}. ` +
          `Received: ${surfaceRaw}`,
      },
      { status: 400 },
    );
  }
  const surface = surfaceRaw as NoraSurface;

  // --- 3. Context + mount guard --------------------------------------------
  const admin = createServiceClient();
  const ctxResult = await buildNoraContext({
    user_id: user.id,
    surface,
    admin,
  });

  if (!ctxResult.ok) {
    if (ctxResult.reason === 'nora_unavailable') {
      // Offboarded Guildmembers without admin flag — product boundary.
      return NextResponse.json(
        {
          error: 'nora_unavailable',
          message:
            'Nora is not available on your account. For support, email ' +
            'support@penworth.ai.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: 'member_not_found' },
      { status: 404 },
    );
  }
  const ctx = ctxResult.context;

  // --- 4. Create conversation ---------------------------------------------
  // nora_conversations.language is NOT NULL with no DEFAULT — supplying
  // explicitly per verification chat schema probe. Falls back to 'en' if
  // the view didn't return a preferred_language (shouldn't happen given
  // the view's NOT NULL on preferred_language, but defensive).
  const { data: conversation, error: insertErr } = await admin
    .from('nora_conversations')
    .insert({
      user_id: user.id,
      surface,
      user_role: ctx.user_role,
      language: ctx.primary_language ?? 'en',
    })
    .select('id, started_at')
    .single();

  if (insertErr || !conversation) {
    console.error('[nora/start] conversation insert failed:', insertErr);
    return NextResponse.json(
      {
        error: 'conversation_creation_failed',
        detail: insertErr?.message ?? 'no row returned',
      },
      { status: 500 },
    );
  }

  // --- 5. Welcome message --------------------------------------------------
  let welcomeMessage = FALLBACK_WELCOME[surface];

  const welcomeSlug = `nora-welcome-${surface}`;
  const { data: welcomeArticle } = await admin
    .from('nora_kb_articles')
    .select('content_markdown, title')
    .eq('slug', welcomeSlug)
    .eq('published', true)
    .maybeSingle();

  if (welcomeArticle?.content_markdown) {
    welcomeMessage = welcomeArticle.content_markdown;
  }

  // --- 6. Insert assistant turn 0 ------------------------------------------
  // Best-effort — if nora_turns insert fails we still return the welcome
  // message to the client. Turn route will look up conversation and
  // proceed even without prior turns. Log for admin visibility.
  const { error: turnErr } = await admin.from('nora_turns').insert({
    conversation_id: conversation.id,
    turn_index: 0,
    role: 'assistant',
    content: welcomeMessage,
  });
  if (turnErr) {
    console.error('[nora/start] turn 0 insert failed (non-fatal):', turnErr);
  }

  // --- 7. Return ------------------------------------------------------------
  return NextResponse.json({
    conversation_id: conversation.id,
    welcome_message: welcomeMessage,
    // Lightweight context summary for the widget — no sensitive fields.
    context_summary: {
      surface,
      user_role: ctx.user_role,
      primary_language: ctx.primary_language,
      is_admin: ctx.is_admin,
    },
  });
}
