import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { isSupportedLocale, isRTL, type Locale } from '@/lib/i18n/strings';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  // Fetch user profile (includes preferred_language for i18n)
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Fetch user's organization (if any)
  const { data: membership } = await supabase
    .from('org_members')
    .select('organizations(*)')
    .eq('user_id', user.id)
    .single();

  const organization = membership?.organizations as any;

  const userData = {
    id: user.id,
    email: user.email || '',
    full_name: profile?.full_name || user.user_metadata?.full_name,
    avatar_url: profile?.avatar_url || user.user_metadata?.avatar_url,
    is_admin: profile?.is_admin === true,
  };

  // Resolve locale + direction for the shell. Falls back to English for any
  // unrecognised code so a corrupted row can't crash the layout.
  const rawLang = (profile?.preferred_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';
  const dir = isRTL(locale) ? 'rtl' : 'ltr';

  return (
    <div className="min-h-screen bg-background" dir={dir} lang={locale}>
      <Sidebar user={userData} organization={organization} locale={locale} />
      <main className={dir === 'rtl' ? 'pr-64' : 'pl-64'}>
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
