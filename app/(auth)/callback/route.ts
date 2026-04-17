import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { originForLanguage, isSupportedLang } from '@/lib/lang-routing';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard';
  const langParam = searchParams.get('lang');

  if (code) {
    const supabase = await createClient();
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

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
