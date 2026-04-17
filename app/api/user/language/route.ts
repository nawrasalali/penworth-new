import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { originForLanguage, isSupportedLang } from '@/lib/lang-routing';

/**
 * POST /api/user/language
 * body: { language: 'ar' | 'es' | ... }
 *
 * Updates the user's preferred_language, then returns the origin of their
 * new language subdomain. The client is expected to window.location.href to
 * `${redirectUrl}/dashboard` so the session cookie follows via the parent
 * domain and the new shell renders in the chosen language.
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
  const targetOrigin = originForLanguage(origin, language);

  return NextResponse.json({
    success: true,
    language,
    redirectUrl: `${targetOrigin}/dashboard`,
  });
}
