'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  BookOpen,
  Users,
  Settings,
  HelpCircle,
  LogOut,
  Plus,
  Building2,
  ChevronDown,
  CreditCard,
  Gift,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { t, isRTL, type Locale, type StringKey } from '@/lib/i18n/strings';

interface SidebarProps {
  user: {
    id: string;
    email: string;
    full_name?: string;
    avatar_url?: string;
    is_admin?: boolean;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  locale?: Locale;
}

type NavItem = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: StringKey;
};

const mainNav: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/books', icon: BookOpen, labelKey: 'nav.myBooks' },
];

const orgNav: NavItem[] = [
  { href: '/organization', icon: Building2, labelKey: 'nav.organization' },
  { href: '/organization/members', icon: Users, labelKey: 'nav.members' },
];

const bottomNav: NavItem[] = [
  { href: '/referrals', icon: Gift, labelKey: 'nav.referrals' },
  { href: '/billing', icon: CreditCard, labelKey: 'nav.billing' },
  { href: '/settings', icon: Settings, labelKey: 'nav.settings' },
  { href: '/help', icon: HelpCircle, labelKey: 'nav.help' },
];

export function Sidebar({ user, organization, locale = 'en' }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  // Mobile drawer state. On viewports <768px the sidebar is hidden by default
  // and toggled via a hamburger button in a mobile top bar. On md+ viewports
  // the sidebar is always visible (the drawer state is ignored).
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes. Without this, users
  // tap a nav link, navigate, and land on the new page with the drawer still
  // open covering the content. Effect runs on every pathname change; cheap.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close the drawer if the viewport grows past the md breakpoint mid-session
  // (e.g. device rotation, window resize on tablet). The md: responsive
  // classes already handle the static layout; this just makes sure state is
  // consistent so when the viewport shrinks again the sidebar isn't stuck
  // open in a detached state.
  useEffect(() => {
    const onResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Lock body scroll when drawer is open on mobile — otherwise swiping on the
  // backdrop scrolls the underlying page content instead of closing the
  // drawer, which is disorienting.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = mobileOpen ? 'hidden' : prev || '';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email?.slice(0, 2).toUpperCase() || 'U';
  };

  const rtl = isRTL(locale);
  // Closed-state transform for the drawer. On LTR, the drawer slides off to
  // the left (off-screen negative X). On RTL, it slides off to the right
  // (off-screen positive X). On md+ the drawer is always visible, so the
  // `md:translate-x-0` override wins regardless of direction.
  const closedTranslate = rtl ? 'translate-x-full' : '-translate-x-full';

  return (
    <>
      {/* MOBILE TOP BAR — hidden on md+ where the sidebar is always visible.
          Houses the hamburger button, Penworth wordmark, and nothing else.
          Height matches the editor's top bar (h-12) so mobile-editor and
          mobile-dashboard chrome stack predictably. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 border-b bg-card flex items-center justify-between px-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg hover:bg-muted text-foreground"
          aria-label={t('nav.openMenu', locale)}
          title={t('nav.openMenu', locale)}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-base">P</span>
          </div>
          <span className="font-bold text-base">Penworth</span>
        </Link>
        {/* Spacer to balance the hamburger — keeps the logo visually centered */}
        <div className="w-9" aria-hidden="true" />
      </div>

      {/* BACKDROP — tap-to-close overlay when drawer is open on mobile.
          z-index sits between the mobile topbar (z-30) and the drawer (z-40)
          so the drawer stays above the backdrop. */}
      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={t('nav.closeMenu', locale)}
          className="md:hidden fixed inset-0 z-[35] bg-black/50 backdrop-blur-sm"
        />
      )}

      {/* SIDEBAR — the existing drawer content, unchanged below the aside
          wrapper. Becomes a slide-in drawer on <md, a static fixed rail on
          md+. Using transform rather than conditional render so the drawer
          slide animation works both directions.

          One added element inside: a close button (X) visible on <md only,
          so a user who opened the drawer can close it without scrolling
          down to find a nav link. */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card',
          'transition-transform duration-200 ease-out',
          'md:translate-x-0',
          mobileOpen ? 'translate-x-0' : closedTranslate
        )}
      >
        {/* Mobile close button — absolute, top-right corner. Hidden on md+. */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label={t('nav.closeMenu', locale)}
          title={t('nav.closeMenu', locale)}
          className="md:hidden absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">P</span>
            </div>
            <span className="font-bold text-xl">Penworth</span>
          </Link>
        </div>

        {/* New Project Button */}
        <div className="p-4">
          <Link href="/books/new">
            <Button className="w-full justify-start">
              <Plus className="mr-2 h-4 w-4" />
              {t('nav.newProject', locale)}
            </Button>
          </Link>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-1 px-3 overflow-y-auto">
          <div className="space-y-1">
            {mainNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey, locale)}
                </Link>
              );
            })}
          </div>

          {/* Organization Section */}
          {organization && (
            <div className="pt-4">
              <button
                onClick={() => setShowOrgMenu(!showOrgMenu)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <span>{t('nav.organization', locale)}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    showOrgMenu && 'rotate-180'
                  )}
                />
              </button>
              {showOrgMenu && (
                <div className="space-y-1 mt-1">
                  {orgNav.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {t(item.labelKey, locale)}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Bottom Navigation */}
        <div className="border-t p-3 space-y-1">
          {user.is_admin && (
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              {t('nav.commandCenter', locale)}
            </Link>
          )}
          {bottomNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey, locale)}
              </Link>
            );
          })}
        </div>

        {/* User Profile */}
        <div className="border-t p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name || user.email}
                  className="h-9 w-9 rounded-full"
                />
              ) : (
                getInitials(user.full_name, user.email)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user.full_name || t('nav.userFallback', locale)}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={t('nav.signOut', locale)}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
