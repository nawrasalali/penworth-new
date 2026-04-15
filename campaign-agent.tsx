import { Target, Users, Globe, TrendingUp, Calendar, MapPin, AlertTriangle } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/client';

interface Campaign {
  id: string;
  name: string;
  country_code: string;
  status: string;
  target_signups: number;
  bonus_credits: number;
  landing_url: string;
  created_at: string;
  signups_count?: number;
  conversion_rate?: number;
}

async function getCampaignData() {
  const supabase = createAdminClient();
  
  try {
    // Get active campaigns
    const { data: campaigns, error: campaignError } = await supabase
      .from('expansion_campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (campaignError) throw campaignError;

    // Get signup counts per campaign
    const campaignStats = await Promise.all(
      (campaigns || []).map(async (campaign) => {
        const { count: signups } = await supabase
          .from('distributor_signups')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id);

        return {
          ...campaign,
          signups_count: signups || 0,
          conversion_rate: campaign.target_signups > 0 
            ? ((signups || 0) / campaign.target_signups) * 100 
            : 0,
        };
      })
    );

    // Get upcoming events
    const { data: events } = await supabase
      .from('expansion_events')
      .select(`
        *,
        registrations:event_registrations(count)
      `)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true })
      .limit(5);

    // Get total signups across all campaigns
    const { count: totalSignups } = await supabase
      .from('distributor_signups')
      .select('*', { count: 'exact', head: true });

    return {
      campaigns: campaignStats,
      events: events || [],
      totalSignups: totalSignups || 0,
      lastSynced: new Date(),
    };
  } catch (error) {
    console.error('Campaign Agent error:', error);
    return null;
  }
}

export async function CampaignAgent() {
  const data = await getCampaignData();

  if (!data) {
    return (
      <div className="metric-card agent-campaign data-unavailable">
        <AgentHeader icon={<Target />} title="Campaign Agent" subtitle="Expansion Intelligence" />
        <div className="text-center py-8 text-red-400">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>Data unavailable</p>
        </div>
      </div>
    );
  }

  const activeCampaigns = data.campaigns.filter(c => c.status === 'active');
  const totalTarget = activeCampaigns.reduce((sum, c) => sum + c.target_signups, 0);

  return (
    <div className="metric-card agent-campaign data-fresh">
      <AgentHeader icon={<Target />} title="Campaign Agent" subtitle="Expansion Intelligence" />
      
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4 mb-4">
        <div className="p-3 rounded-lg bg-navy-900/50">
          <div className="text-xs text-navy-400">Total Signups</div>
          <div className="text-xl font-bold text-white">{data.totalSignups.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded-lg bg-navy-900/50">
          <div className="text-xs text-navy-400">Target</div>
          <div className="text-xl font-bold text-white">{totalTarget.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded-lg bg-navy-900/50">
          <div className="text-xs text-navy-400">Progress</div>
          <div className="text-xl font-bold text-emerald-400">
            {totalTarget > 0 ? ((data.totalSignups / totalTarget) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      {/* Active Campaigns */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-navy-300">Active Campaigns</h3>
        {activeCampaigns.length === 0 ? (
          <p className="text-xs text-navy-500">No active campaigns</p>
        ) : (
          activeCampaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))
        )}
      </div>

      {/* Upcoming Events */}
      {data.events.length > 0 && (
        <div className="mt-4 pt-4 border-t border-navy-700/50">
          <h3 className="text-sm font-medium text-navy-300 mb-2">Upcoming Events</h3>
          <div className="space-y-2">
            {data.events.map((event: any) => (
              <div key={event.id} className="flex items-center justify-between p-2 rounded bg-navy-900/30">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-navy-400" />
                  <span className="text-sm text-white">{event.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-navy-400">
                    {new Date(event.event_date).toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Users className="h-3 w-3" />
                    {event.registrations?.[0]?.count || 0}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <DataFreshness lastSynced={data.lastSynced} />
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const countryFlags: Record<string, string> = {
    VN: '🇻🇳',
    TH: '🇹🇭',
    ID: '🇮🇩',
    PH: '🇵🇭',
    IN: '🇮🇳',
    BD: '🇧🇩',
    SA: '🇸🇦',
    AE: '🇦🇪',
    AU: '🇦🇺',
  };

  return (
    <div className="p-3 rounded-lg bg-navy-900/50 border border-navy-700/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{countryFlags[campaign.country_code] || '🌍'}</span>
          <span className="font-medium text-white">{campaign.name}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs ${
          campaign.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-navy-700 text-navy-400'
        }`}>
          {campaign.status}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="h-2 bg-navy-800 rounded-full overflow-hidden mb-2">
        <div 
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
          style={{ width: `${Math.min(100, campaign.conversion_rate || 0)}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs">
        <span className="text-navy-400">
          {campaign.signups_count?.toLocaleString()} / {campaign.target_signups.toLocaleString()} signups
        </span>
        <span className="text-emerald-400 font-medium">
          {(campaign.conversion_rate || 0).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function AgentHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400">
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
