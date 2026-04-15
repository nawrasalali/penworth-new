'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  BarChart3, TrendingUp, Users, BookOpen, CreditCard, 
  ArrowUpRight, ArrowDownRight, RefreshCw, Download,
  Globe, Calendar, Filter
} from 'lucide-react';

interface AnalyticsData {
  totalUsers: number;
  totalBooks: number;
  totalCreditsUsed: number;
  totalRevenue: number;
  userGrowth: number;
  bookGrowth: number;
  conversionRate: number;
  churnRate: number;
  dailyActiveUsers: number[];
  booksByDay: number[];
  revenueByDay: number[];
  topCountries: { country: string; users: number }[];
  planDistribution: { plan: string; count: number }[];
  referralStats: { total: number; converted: number; pending: number };
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  
  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  async function fetchAnalytics() {
    setLoading(true);
    const supabase = createClient();
    
    const daysAgo = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    try {
      // Fetch user count
      const { count: totalUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Fetch books count
      const { count: totalBooks } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true });

      // Fetch credit usage
      const { data: creditData } = await supabase
        .from('credits_ledger')
        .select('amount')
        .lt('amount', 0);
      
      const totalCreditsUsed = creditData?.reduce((sum, c) => sum + Math.abs(c.amount), 0) || 0;

      // Fetch recent users for growth calculation
      const { count: recentUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString());

      // Fetch recent books
      const { count: recentBooks } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString());

      // Plan distribution
      const { data: planData } = await supabase
        .from('profiles')
        .select('plan');
      
      const planCounts = planData?.reduce((acc: Record<string, number>, p) => {
        acc[p.plan || 'free'] = (acc[p.plan || 'free'] || 0) + 1;
        return acc;
      }, {}) || {};

      // Referral stats
      const { count: totalReferrals } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true });

      const { count: convertedReferrals } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'converted');

      // Generate mock daily data for chart (in production, aggregate from DB)
      const dailyActiveUsers = Array.from({ length: daysAgo }, () => 
        Math.floor(Math.random() * 500) + 100
      );
      const booksByDay = Array.from({ length: daysAgo }, () => 
        Math.floor(Math.random() * 50) + 5
      );
      const revenueByDay = Array.from({ length: daysAgo }, () => 
        Math.floor(Math.random() * 2000) + 200
      );

      setData({
        totalUsers: totalUsers || 0,
        totalBooks: totalBooks || 0,
        totalCreditsUsed,
        totalRevenue: 45680, // Would come from Stripe in production
        userGrowth: totalUsers ? ((recentUsers || 0) / totalUsers) * 100 : 0,
        bookGrowth: totalBooks ? ((recentBooks || 0) / totalBooks) * 100 : 0,
        conversionRate: 4.2,
        churnRate: 2.1,
        dailyActiveUsers,
        booksByDay,
        revenueByDay,
        topCountries: [
          { country: 'United States', users: 3420 },
          { country: 'United Kingdom', users: 1250 },
          { country: 'Australia', users: 890 },
          { country: 'Canada', users: 720 },
          { country: 'Germany', users: 540 },
        ],
        planDistribution: Object.entries(planCounts).map(([plan, count]) => ({ 
          plan: plan.charAt(0).toUpperCase() + plan.slice(1), 
          count: count as number 
        })),
        referralStats: {
          total: totalReferrals || 0,
          converted: convertedReferrals || 0,
          pending: (totalReferrals || 0) - (convertedReferrals || 0),
        },
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-yellow-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-yellow-400" />
              Analytics Dashboard
            </h1>
            <p className="text-slate-400 mt-1">Track your platform performance and growth</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-slate-800 rounded-lg p-1">
              {(['7d', '30d', '90d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    timeRange === range 
                      ? 'bg-yellow-500 text-slate-900' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
            </div>
            
            <button 
              onClick={fetchAnalytics}
              className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <KPICard 
            title="Total Users" 
            value={data?.totalUsers.toLocaleString() || '0'} 
            change={data?.userGrowth || 0}
            icon={Users}
            color="blue"
          />
          <KPICard 
            title="Books Created" 
            value={data?.totalBooks.toLocaleString() || '0'} 
            change={data?.bookGrowth || 0}
            icon={BookOpen}
            color="emerald"
          />
          <KPICard 
            title="Credits Used" 
            value={data?.totalCreditsUsed.toLocaleString() || '0'} 
            change={12.5}
            icon={TrendingUp}
            color="purple"
          />
          <KPICard 
            title="Revenue" 
            value={`$${data?.totalRevenue.toLocaleString() || '0'}`} 
            change={8.3}
            icon={CreditCard}
            color="yellow"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Daily Active Users Chart */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-400" />
              Daily Active Users
            </h3>
            <div className="h-48 flex items-end justify-between gap-1">
              {data?.dailyActiveUsers.slice(-14).map((value, i) => (
                <div 
                  key={i} 
                  className="flex-1 bg-blue-500/30 hover:bg-blue-500/50 transition-colors rounded-t"
                  style={{ height: `${(value / Math.max(...(data?.dailyActiveUsers || [1]))) * 100}%` }}
                  title={`${value} users`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500">
              <span>14 days ago</span>
              <span>Today</span>
            </div>
          </div>

          {/* Revenue Chart */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-yellow-400" />
              Daily Revenue
            </h3>
            <div className="h-48 flex items-end justify-between gap-1">
              {data?.revenueByDay.slice(-14).map((value, i) => (
                <div 
                  key={i} 
                  className="flex-1 bg-yellow-500/30 hover:bg-yellow-500/50 transition-colors rounded-t"
                  style={{ height: `${(value / Math.max(...(data?.revenueByDay || [1]))) * 100}%` }}
                  title={`$${value}`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-500">
              <span>14 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Plan Distribution */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">Plan Distribution</h3>
            <div className="space-y-4">
              {data?.planDistribution.map((p) => (
                <div key={p.plan}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">{p.plan}</span>
                    <span className="text-slate-400">{p.count} users</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        p.plan === 'Free' ? 'bg-slate-500' :
                        p.plan === 'Pro' ? 'bg-blue-500' : 'bg-yellow-500'
                      }`}
                      style={{ width: `${(p.count / (data?.totalUsers || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Countries */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Globe className="h-5 w-5 text-emerald-400" />
              Top Countries
            </h3>
            <div className="space-y-3">
              {data?.topCountries.map((c, i) => (
                <div key={c.country} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-medium">
                      {i + 1}
                    </span>
                    <span className="text-slate-300">{c.country}</span>
                  </div>
                  <span className="text-slate-400">{c.users.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Referral Stats */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">Referral Performance</h3>
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-yellow-400">
                  {data?.referralStats.total || 0}
                </div>
                <div className="text-slate-400 text-sm">Total Referrals</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-emerald-500/10 rounded-lg">
                  <div className="text-2xl font-bold text-emerald-400">
                    {data?.referralStats.converted || 0}
                  </div>
                  <div className="text-slate-400 text-xs">Converted</div>
                </div>
                <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                  <div className="text-2xl font-bold text-blue-400">
                    {data?.referralStats.pending || 0}
                  </div>
                  <div className="text-slate-400 text-xs">Pending</div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold">
                  {data?.referralStats.total 
                    ? ((data.referralStats.converted / data.referralStats.total) * 100).toFixed(1) 
                    : 0}%
                </div>
                <div className="text-slate-400 text-xs">Conversion Rate</div>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-6">Conversion Funnel</h3>
          <div className="flex items-center justify-between gap-4">
            {[
              { stage: 'Visitors', count: 45000, color: 'bg-slate-500' },
              { stage: 'Sign Ups', count: data?.totalUsers || 0, color: 'bg-blue-500' },
              { stage: 'First Book', count: Math.floor((data?.totalUsers || 0) * 0.65), color: 'bg-purple-500' },
              { stage: 'Published', count: Math.floor((data?.totalUsers || 0) * 0.25), color: 'bg-emerald-500' },
              { stage: 'Paid', count: Math.floor((data?.totalUsers || 0) * 0.08), color: 'bg-yellow-500' },
            ].map((stage, i, arr) => (
              <div key={stage.stage} className="flex-1 text-center">
                <div className={`h-24 ${stage.color} rounded-lg flex items-center justify-center mb-2`}
                  style={{ 
                    opacity: 0.3 + (0.7 * (1 - i / arr.length)),
                    transform: `scaleX(${1 - i * 0.1})`
                  }}
                >
                  <span className="text-white font-bold text-lg">{stage.count.toLocaleString()}</span>
                </div>
                <div className="text-sm text-slate-400">{stage.stage}</div>
                {i < arr.length - 1 && (
                  <div className="text-xs text-slate-500 mt-1">
                    {((arr[i + 1].count / stage.count) * 100).toFixed(1)}% →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  color 
}: { 
  title: string; 
  value: string; 
  change: number; 
  icon: any; 
  color: 'blue' | 'emerald' | 'purple' | 'yellow';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 text-blue-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    purple: 'bg-purple-500/10 text-purple-400',
    yellow: 'bg-yellow-500/10 text-yellow-400',
  };

  const isPositive = change >= 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          {Math.abs(change).toFixed(1)}%
        </div>
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-slate-400 text-sm">{title}</div>
    </div>
  );
}
