import { Suspense } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  Users, 
  Cpu, 
  Building2, 
  CreditCard,
  GitBranch,
  Shield,
  Bell,
  RefreshCw,
  Target
} from 'lucide-react';
import { CFOAgent } from '@/components/agents/cfo-agent';
import { CMOAgent } from '@/components/agents/cmo-agent';
import { CTOAgent } from '@/components/agents/cto-agent';
import { COOAgent } from '@/components/agents/coo-agent';
import { CampaignAgent } from '@/components/agents/campaign-agent';
import { MDAgent } from '@/components/agents/md-agent';
import { AlertsPanel } from '@/components/alerts-panel';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export default function CommandCenter() {
  return (
    <div className="min-h-screen bg-navy-950">
      {/* Header */}
      <header className="border-b border-navy-800 bg-navy-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <span className="text-xl font-bold">P</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">Command Center</h1>
                  <p className="text-xs text-navy-400">Executive Intelligence</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Alerts */}
              <button className="relative p-2 rounded-lg hover:bg-navy-800 transition-colors">
                <Bell className="h-5 w-5 text-navy-400" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>
              
              {/* Refresh */}
              <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-800 hover:bg-navy-700 transition-colors text-sm">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              
              {/* Last Updated */}
              <div className="text-xs text-navy-400">
                Last synced: {new Date().toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Financial & Marketing Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Suspense fallback={<AgentSkeleton title="CFO Agent" />}>
            <CFOAgent />
          </Suspense>

          <Suspense fallback={<AgentSkeleton title="CMO Agent" />}>
            <CMOAgent />
          </Suspense>
        </div>

        {/* Campaign Agent - Full Width */}
        <div className="mb-6">
          <Suspense fallback={<AgentSkeleton title="Campaign Agent" />}>
            <CampaignAgent />
          </Suspense>
        </div>

        {/* Master Distributor Agent - Full Width */}
        <div className="mb-6">
          <Suspense fallback={<AgentSkeleton title="Distributor Agent" wide />}>
            <MDAgent />
          </Suspense>
        </div>

        {/* Tech & Ops Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Suspense fallback={<AgentSkeleton title="CTO Agent" />}>
            <CTOAgent />
          </Suspense>

          <Suspense fallback={<AgentSkeleton title="COO Agent" />}>
            <COOAgent />
          </Suspense>
        </div>

        {/* Alerts Panel */}
        <div className="mt-8">
          <Suspense fallback={<div className="metric-card animate-pulse h-48" />}>
            <AlertsPanel />
          </Suspense>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-navy-800 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-navy-500">
            <span>Penworth Command Center v1.1</span>
            <span>A.C.N. 675 668 710 PTY LTD</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AgentSkeleton({ title, wide }: { title: string; wide?: boolean }) {
  return (
    <div className={`metric-card animate-pulse ${wide ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-navy-700" />
        <div className="h-5 w-32 bg-navy-700 rounded" />
      </div>
      <div className="space-y-3">
        <div className="h-16 bg-navy-700 rounded" />
        <div className="h-16 bg-navy-700 rounded" />
        <div className="h-16 bg-navy-700 rounded" />
      </div>
    </div>
  );
}
