import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { originForLanguage, isSupportedLang } from '@/lib/lang-routing';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard';
  const langParam = searchParams.get('lang');
  // skip_code=1 indicates this is a post-password-login redirect (no OAuth code
  // to exchange). We still need to resolve the user's language and redirect.
  const skipCode = searchParams.get('skip_code') === '1';

  const supabase = await createClient();

  // Exchange the OAuth code if present
  if (code) {
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      if (isSupportedLang(langParam)) {
        await supabase
          .from('profiles')
          .update({ preferred_language: langParam })
          .eq('id', data.user.id);
      }

      let lang: string | null = langParam;
      if (!isSupportedLang(lang)) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', data.user.id)
          .single();
        lang = profile?.preferred_language ?? 'en';
      }

      const targetOrigin = originForLanguage(origin, lang);
      return NextResponse.redirect(`${targetOrigin}${redirect}`);
    }
  }

  // No code but session is already established (password login): resolve lang
  // from URL param and redirect.
  if (skipCode) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      let lang: string | null = langParam;
      if (!isSupportedLang(lang)) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('preferred_language')
          .eq('id', user.id)
          .single();
        lang = profile?.preferred_language ?? 'en';
      }
      const targetOrigin = originForLanguage(origin, lang);
      return NextResponse.redirect(`${targetOrigin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
