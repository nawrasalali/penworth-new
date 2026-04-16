import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Plus,
  FileText,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
  BookOpen,
  FileSpreadsheet,
  GraduationCap,
  Briefcase,
  Coins,
  Crown,
} from 'lucide-react';
import { formatRelativeTime, formatWordCount, CONTENT_TYPE_LABELS, STATUS_COLORS } from '@/lib/utils';

const quickStartTemplates = [
  { icon: BookOpen, label: 'Book', type: 'book', description: 'Write a full book with AI assistance' },
  { icon: FileText, label: 'Research Paper', type: 'paper', description: 'Academic paper with citations' },
  { icon: Briefcase, label: 'Business Plan', type: 'business_plan', description: 'Comprehensive business plan' },
  { icon: GraduationCap, label: 'Educational Content', type: 'educational', description: 'Curriculum-aligned materials' },
];

const PLAN_DISPLAY = {
  free: { name: 'Free', color: 'bg-gray-100 text-gray-800' },
  pro: { name: 'Pro', color: 'bg-blue-100 text-blue-800' },
  max: { name: 'Max', color: 'bg-purple-100 text-purple-800' },
};

const PLAN_LIMITS = {
  free: { credits: 1000, docs: 1 },
  pro: { credits: 2000, docs: 2 },
  max: { credits: 5000, docs: 5 },
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Fetch profile with plan and credits
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits_balance, credits_purchased, documents_this_month')
    .eq('id', user?.id)
    .single();

  const plan = (profile?.plan || 'free') as keyof typeof PLAN_DISPLAY;
  const planInfo = PLAN_DISPLAY[plan];
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

  return (
    <div className="p-8">
      {/* Plan Badge */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back! Here's an overview of your knowledge creation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/billing">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${planInfo.color}`}>
              <Crown className="h-4 w-4" />
              {planInfo.name} Plan
            </div>
          </Link>
          <Link href="/projects/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Credits Available</CardTitle>
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
              {creditsBalance.toLocaleString()} monthly + {creditsPurchased.toLocaleString()} purchased
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documents This Month</CardTitle>
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
              {planLimits.docs - documentsThisMonth} remaining
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Words Generated</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatWordCount(totalWords)}</div>
            <p className="text-xs text-muted-foreground">
              Last 30 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projectCount}</div>
            <p className="text-xs text-muted-foreground">
              {recentProjects?.filter(p => p.status === 'draft' || p.status === 'in_progress').length || 0} in progress
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Recent Projects */}
        <Card className="col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Projects</CardTitle>
              <Link href="/projects">
                <Button variant="ghost" size="sm">
                  View all
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
            <CardDescription>Your most recently updated projects</CardDescription>
          </CardHeader>
          <CardContent>
            {recentProjects && recentProjects.length > 0 ? (
              <div className="space-y-4">
                {recentProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
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
                      {project.status.replace('_', ' ')}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-sm text-muted-foreground">
                  No projects yet. Create your first project to get started.
                </p>
                <Link href="/projects/new">
                  <Button className="mt-4" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Project
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Start */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>Start a new project from a template</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {quickStartTemplates.map((template) => (
                <Link
                  key={template.type}
                  href={`/projects/new?type=${template.type}`}
                  className="flex flex-col items-center p-4 rounded-lg border hover:bg-muted/50 hover:border-primary/50 transition-colors text-center"
                >
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                    <template.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="font-medium text-sm">{template.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {template.description}
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
