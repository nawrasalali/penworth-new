import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Plus,
  FileText,
  Clock,
  TrendingUp,
  ArrowRight,
  BookOpen,
  PenLine,
  User,
  Heart,
  Coins,
  Crown,
  Handshake,
} from 'lucide-react';
import { formatRelativeTime, formatWordCount, CONTENT_TYPE_LABELS, STATUS_COLORS } from '@/lib/utils';
import { t, isSupportedLocale, type Locale, type StringKey } from '@/lib/i18n/strings';

// Quick start templates: the four most-common book types a Penworth writer
// starts from. These align with book category IDs in /projects/new so the
// `?type=` query pre-selects the category on the new-project page.
const quickStartTemplates: Array<{
  icon: typeof BookOpen;
  labelKey: StringKey;
  descKey: StringKey;
  type: string;
}> = [
  { icon: BookOpen, labelKey: 'dashboard.tpl.nonFiction', descKey: 'dashboard.tpl.nonFiction.desc', type: 'non-fiction' },
  { icon: PenLine,  labelKey: 'dashboard.tpl.fiction',    descKey: 'dashboard.tpl.fiction.desc',    type: 'fiction'     },
  { icon: User,     labelKey: 'dashboard.tpl.memoir',     descKey: 'dashboard.tpl.memoir.desc',     type: 'memoir'      },
  { icon: Heart,    labelKey: 'dashboard.tpl.selfHelp',   descKey: 'dashboard.tpl.selfHelp.desc',   type: 'self-help'   },
];

const PLAN_COLORS = {
  free: 'bg-gray-100 text-gray-800',
  pro: 'bg-blue-100 text-blue-800',
  max: 'bg-purple-100 text-purple-800',
} as const;

const PLAN_LIMITS = {
  free: { credits: 1000, docs: 1 },
  pro: { credits: 2000, docs: 2 },
  max: { credits: 5000, docs: 5 },
} as const;

const PLAN_NAME_KEYS: Record<keyof typeof PLAN_COLORS, StringKey> = {
  free: 'dashboard.planFree',
  pro: 'dashboard.planPro',
  max: 'dashboard.planMax',
};

/**
 * Map a raw project.status DB value to its localised display label using the
 * existing projects.status* keys (already present in every bundle).
 */
function statusLabel(status: string, locale: Locale): string {
  switch (status) {
    case 'draft':
      return t('projects.statusDraft', locale);
    case 'in_progress':
    case 'writing':
      return t('projects.statusWriting', locale);
    case 'completed':
      return t('projects.statusComplete', locale);
    case 'published':
      return t('projects.statusPublished', locale);
    default:
      return status.replace(/_/g, ' ');
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Single round-trip for profile state: plan, credits, documents count,
  // AND preferred_language so the whole page renders in the user's locale.
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance, credits_purchased, documents_this_month, preferred_language')
    .eq('id', user?.id)
    .single();

  const rawLang = (profile?.preferred_language || 'en').toLowerCase();
  const locale: Locale = isSupportedLocale(rawLang) ? rawLang : 'en';

  const plan = (profile?.plan || 'free') as keyof typeof PLAN_COLORS;
  const planColor = PLAN_COLORS[plan];
  const planLimits = PLAN_LIMITS[plan];
  const creditsBalance = profile?.credits_balance || 0;
  const creditsPurchased = profile?.credits_purchased || 0;
  const totalCredits = creditsBalance + creditsPurchased;
  const documentsThisMonth = profile?.documents_this_month || 0;

  // Fetch recent projects
  const { data: recentProjects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user?.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(5);

  // Fetch usage stats
  const { data: usageStats } = await supabase
    .from('usage')
    .select('tokens_input, tokens_output')
    .eq('user_id', user?.id)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const totalWords = usageStats?.reduce((acc, u) => acc + Math.floor((u.tokens_input + u.tokens_output) / 1.3), 0) || 0;
  const projectCount = recentProjects?.length || 0;
  const inProgressCount =
    recentProjects?.filter((p) => p.status === 'draft' || p.status === 'in_progress').length || 0;

  return (
    <div className="p-8">
      {/* Plan Badge */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title', locale)}</h1>
          <p className="text-muted-foreground mt-1">{t('dashboard.subtitle', locale)}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/billing">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${planColor}`}>
              <Crown className="h-4 w-4" />
              {t(PLAN_NAME_KEYS[plan], locale)} {t('dashboard.planSuffix', locale)}
            </div>
          </Link>
          <Link href="/books/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('dashboard.newProject', locale)}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.creditsAvailable', locale)}</CardTitle>
            <Coins className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCredits.toLocaleString()}</div>
            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (creditsBalance / planLimits.credits) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('dashboard.monthlyPurchasedTemplate', locale)
                .replace('{monthly}', creditsBalance.toLocaleString())
                .replace('{purchased}', creditsPurchased.toLocaleString())}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.documentsThisMonth', locale)}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentsThisMonth} / {planLimits.docs}</div>
            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(documentsThisMonth / planLimits.docs) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('dashboard.remaining', locale).replace('{n}', String(Math.max(0, planLimits.docs - documentsThisMonth)))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.wordsGenerated', locale)}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatWordCount(totalWords)}</div>
            <p className="text-xs text-muted-foreground">{t('dashboard.last30Days', locale)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('dashboard.totalProjects', locale)}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projectCount}</div>
            <p className="text-xs text-muted-foreground">
              {t('dashboard.inProgress', locale).replace('{n}', String(inProgressCount))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Guild promo banner — links to partner program subdomain */}
      <a
        href="https://guild.penworth.ai"
        rel="noopener noreferrer"
        className="group mb-8 block rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent hover:from-amber-500/15 hover:via-amber-500/10 transition-colors"
      >
        <div className="flex items-center gap-4 p-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
            <Handshake className="h-6 w-6 text-amber-600 dark:text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">{t('dashboard.guildCardTitle', locale)}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t('dashboard.guildCardBody', locale)}
            </p>
          </div>
          <div className="shrink-0 hidden sm:flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 group-hover:gap-3 transition-all">
            {t('dashboard.guildCardCta', locale)}
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </a>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Recent Projects */}
        <Card className="col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t('dashboard.recentProjects', locale)}</CardTitle>
              <Link href="/books">
                <Button variant="ghost" size="sm">
                  {t('dashboard.viewAll', locale)}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
            <CardDescription>{t('dashboard.recentProjectsDesc', locale)}</CardDescription>
          </CardHeader>
          <CardContent>
            {recentProjects && recentProjects.length > 0 ? (
              <div className="space-y-4">
                {recentProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/books/${project.id}/editor`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{project.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {CONTENT_TYPE_LABELS[project.content_type]} • {formatRelativeTime(project.updated_at)}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLORS[project.status]?.bg || 'bg-neutral-100'} ${STATUS_COLORS[project.status]?.text || 'text-neutral-600'}`}>
                      {statusLabel(project.status, locale)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm text-muted-foreground">
                  {t('dashboard.noProjects', locale)}
                </p>
                <Link href="/books/new">
                  <Button className="mt-4" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('dashboard.createProject', locale)}
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Start */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>{t('dashboard.quickStart', locale)}</CardTitle>
            <CardDescription>{t('dashboard.quickStartDesc', locale)}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {quickStartTemplates.map((template) => (
                <Link
                  key={template.type}
                  href={`/books/new?type=${template.type}`}
                  className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                    <template.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-medium text-sm">{t(template.labelKey, locale)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(template.descKey, locale)}
                  </p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
