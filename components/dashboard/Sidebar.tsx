'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  Store,
  Settings,
  HelpCircle,
  LogOut,
  Plus,
  Building2,
  ChevronDown,
  CreditCard,
  Gift,
  ShieldCheck,
  Handshake,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { t, type Locale, type StringKey } from '@/lib/i18n/strings';

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
  { href: '/projects', icon: FolderOpen, labelKey: 'nav.myProjects' },
  { href: '/publish', icon: Store, labelKey: 'nav.publish' },
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

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card">
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
          <Link href="/projects/new">
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

          {/* Guild — external link to the partner program */}
          <div className="pt-3">
            <a
              href="https://guild.penworth.ai"
              rel="noopener noreferrer"
              className="group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 text-foreground"
            >
              <Handshake className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span>{t('nav.guild', locale)}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="text-[11px] font-normal text-muted-foreground leading-tight mt-0.5">
                  {t('nav.guildSubtitle', locale)}
                </div>
              </div>
            </a>
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
  );
}
