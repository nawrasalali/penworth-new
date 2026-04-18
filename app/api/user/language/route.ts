import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupportedLang } from '@/lib/lang-routing';

/**
 * POST /api/user/language
 * body: { language: 'ar' | 'es' | ... }
 *
 * Updates the user's preferred_language. The client can reload to pick up
 * the new locale — the in-app shell reads preferred_language on every
 * render, so a full-page nav isn't strictly required, but reloading is
 * simpler than propagating the change to every mounted component.
 *
 * Language subdomains (es.penworth.ai etc.) are static landing pages and
 * don't host the authenticated app, so the redirectUrl always stays on
 * the current origin.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { language } = await request.json();
  if (!isSupportedLang(language)) {
    return NextResponse.json({ error: 'Unsupported language' }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ preferred_language: language })
    .eq('id', user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const origin = new URL(request.url).origin;

  return NextResponse.json({
    success: true,
    language,
    redirectUrl: `${origin}/dashboard`,
  });
}
