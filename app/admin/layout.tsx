import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/dashboard/Sidebar';

/**
 * Admin Command Center layout.
 *
 * Gated server-side: if the authenticated user does not have is_admin=true
 * in their profile, they get redirected to /dashboard. No client-side bypass
 * is possible because this runs in the server component render.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, is_admin')
    .eq('id', user.id)
    .single();

  if (!profile || profile.is_admin !== true) {
    redirect('/dashboard');
  }

  const userData = {
    id: user.id,
    email: user.email || '',
    full_name: profile.full_name || user.user_metadata?.full_name,
    avatar_url: profile.avatar_url || user.user_metadata?.avatar_url,
    is_admin: true,
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar user={userData} organization={null} />
      <main className="pl-64">
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
