import { Users, DollarSign, TrendingUp, Award, AlertTriangle, UserCheck, Clock } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/client';

interface MasterDistributor {
  id: string;
  user_id: string;
  business_name: string;
  country_code: string;
  tier: 'founding' | 'standard' | 'earn_in';
  status: 'active' | 'pending' | 'suspended';
  override_rate: number;
  signups_count: number;
  lifetime_earnings: number;
  created_at: string;
  profile?: {
    email: string;
    full_name: string;
  };
}

async function getMDData() {
  const supabase = createAdminClient();
  
  try {
    // Get all master distributors with their profiles
    const { data: distributors, error } = await supabase
      .from('master_distributors')
      .select(`
        *,
        profile:profiles(email, full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get signup counts for each distributor
    const distributorStats = await Promise.all(
      (distributors || []).map(async (md) => {
        const { count: signups } = await supabase
          .from('distributor_signups')
          .select('*', { count: 'exact', head: true })
          .eq('distributor_id', md.id);

        // Get total payouts
        const { data: payouts } = await supabase
          .from('distributor_payouts')
          .select('amount')
          .eq('distributor_id', md.id)
          .eq('status', 'completed');

        const totalEarnings = payouts?.reduce((sum, p) => sum + p.amount, 0) || 0;

        return {
          ...md,
          signups_count: signups || 0,
          lifetime_earnings: totalEarnings,
        };
      })
    );

    // Summary stats
    const totalDistributors = distributorStats.length;
    const activeDistributors = distributorStats.filter(d => d.status === 'active').length;
    const totalSignups = distributorStats.reduce((sum, d) => sum + d.signups_count, 0);
    const totalEarnings = distributorStats.reduce((sum, d) => sum + d.lifetime_earnings, 0);

    // Pending payouts
    const { data: pendingPayouts } = await supabase
      .from('distributor_payouts')
      .select('amount')
      .eq('status', 'pending');
    
    const pendingAmount = pendingPayouts?.reduce((sum, p) => sum + p.amount, 0) || 0;

    return {
      distributors: distributorStats,
      totalDistributors,
      activeDistributors,
      totalSignups,
      totalEarnings,
      pendingPayouts: pendingAmount,
      lastSynced: new Date(),
    };
  } catch (error) {
    console.error('MD Agent error:', error);
    return null;
  }
}

export async function MDAgent() {
  const data = await getMDData();

  if (!data) {
    return (
      <div className="metric-card agent-md data-unavailable col-span-2">
        <AgentHeader icon={<Users />} title="Distributor Agent" subtitle="Ambassador Network Intelligence" />
        <div className="text-center py-8 text-red-400">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>Data unavailable</p>
        </div>
      </div>
    );
  }

  return (
    <div className="metric-card agent-md data-fresh col-span-2">
      <AgentHeader icon={<Users />} title="Distributor Agent" subtitle="Ambassador Network Intelligence" />
      
      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-3 mt-4 mb-4">
        <StatCard 
          label="Total Ambassadors" 
          value={data.totalDistributors}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard 
          label="Active" 
          value={data.activeDistributors}
          icon={<UserCheck className="h-4 w-4" />}
          highlight
        />
        <StatCard 
          label="Total Signups" 
          value={data.totalSignups}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard 
          label="Paid Out" 
          value={`$${data.totalEarnings.toLocaleString()}`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard 
          label="Pending Payout" 
          value={`$${data.pendingPayouts.toLocaleString()}`}
          icon={<Clock className="h-4 w-4" />}
          alert={data.pendingPayouts > 1000}
        />
      </div>

      {/* Distributor Table */}
      <div className="mt-4">
        <h3 className="text-sm font-medium text-navy-300 mb-2">Ambassador Leaderboard</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-navy-400 border-b border-navy-700">
                <th className="text-left py-2 px-2">Ambassador</th>
                <th className="text-left py-2 px-2">Tier</th>
                <th className="text-left py-2 px-2">Country</th>
                <th className="text-right py-2 px-2">Signups</th>
                <th className="text-right py-2 px-2">Override</th>
                <th className="text-right py-2 px-2">Earnings</th>
                <th className="text-center py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.distributors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-navy-500">
                    No ambassadors yet
                  </td>
                </tr>
              ) : (
                data.distributors
                  .sort((a, b) => b.signups_count - a.signups_count)
                  .slice(0, 10)
                  .map((md, index) => (
                    <DistributorRow key={md.id} distributor={md} rank={index + 1} />
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DataFreshness lastSynced={data.lastSynced} />
    </div>
  );
}

function DistributorRow({ distributor, rank }: { distributor: MasterDistributor; rank: number }) {
  const countryFlags: Record<string, string> = {
    VN: '🇻🇳', TH: '🇹🇭', ID: '🇮🇩', PH: '🇵🇭', IN: '🇮🇳',
    BD: '🇧🇩', SA: '🇸🇦', AE: '🇦🇪', AU: '🇦🇺', US: '🇺🇸',
  };

  const tierColors: Record<string, string> = {
    founding: 'bg-amber-500/20 text-amber-400',
    standard: 'bg-blue-500/20 text-blue-400',
    earn_in: 'bg-navy-600 text-navy-300',
  };

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-500/20 text-emerald-400',
    pending: 'bg-amber-500/20 text-amber-400',
    suspended: 'bg-red-500/20 text-red-400',
  };

  return (
    <tr className="border-b border-navy-800/50 hover:bg-navy-800/30">
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          {rank <= 3 && (
            <Award className={`h-4 w-4 ${
              rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-gray-400' : 'text-amber-700'
            }`} />
          )}
          <div>
            <div className="font-medium text-white">{distributor.business_name}</div>
            <div className="text-xs text-navy-400">{distributor.profile?.email}</div>
          </div>
        </div>
      </td>
      <td className="py-2 px-2">
        <span className={`px-2 py-0.5 rounded text-xs capitalize ${tierColors[distributor.tier]}`}>
          {distributor.tier.replace('_', ' ')}
        </span>
      </td>
      <td className="py-2 px-2">
        <span>{countryFlags[distributor.country_code] || '🌍'}</span>
      </td>
      <td className="py-2 px-2 text-right font-medium text-white">
        {distributor.signups_count.toLocaleString()}
      </td>
      <td className="py-2 px-2 text-right text-navy-300">
        {(distributor.override_rate * 100).toFixed(0)}%
      </td>
      <td className="py-2 px-2 text-right text-emerald-400 font-medium">
        ${distributor.lifetime_earnings.toLocaleString()}
      </td>
      <td className="py-2 px-2 text-center">
        <span className={`px-2 py-0.5 rounded text-xs capitalize ${statusColors[distributor.status]}`}>
          {distributor.status}
        </span>
      </td>
    </tr>
  );
}

function StatCard({ 
  label, 
  value, 
  icon, 
  highlight,
  alert 
}: { 
  label: string; 
  value: string | number; 
  icon?: React.ReactNode;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg bg-navy-900/50 ${
      alert ? 'ring-1 ring-amber-500/50' : highlight ? 'ring-1 ring-emerald-500/30' : ''
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-navy-400">{label}</span>
        {icon && <span className="text-navy-500">{icon}</span>}
      </div>
      <span className={`text-lg font-bold ${highlight ? 'text-emerald-400' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

function AgentHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
        {icon}
      </div>
      <div>
        <h2 className="font-semibold text-white">{title}</h2>
        <p className="text-xs text-navy-400">{subtitle}</p>
      </div>
    </div>
  );
}

function DataFreshness({ lastSynced }: { lastSynced: Date }) {
  return (
    <div className="mt-4 pt-3 border-t border-navy-700/50 flex items-center justify-between text-xs text-navy-500">
      <span>Last synced: {lastSynced.toLocaleTimeString()}</span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        Fresh
      </span>
    </div>
  );
}
