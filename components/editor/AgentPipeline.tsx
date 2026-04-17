'use client';

import { AGENTS, AgentName, AgentStatusMap, getAgentLabels } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { t, type Locale } from '@/lib/i18n/strings';

interface AgentPipelineProps {
  currentAgent: AgentName;
  agentStatus: AgentStatusMap;
  activeMessages?: { line1: string; line2: string };
  locale?: Locale;
}

export function AgentPipeline({ 
  currentAgent, 
  agentStatus,
  activeMessages,
  locale = 'en',
}: AgentPipelineProps) {
  return (
    <div className="w-[200px] shrink-0 border-r bg-muted/20 p-3 overflow-y-auto">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {t('editor.agentPipeline', locale)}
      </h2>
      
      <div className="space-y-2">
        {AGENTS.map((agent) => {
          const status = agentStatus[agent.id];
          const isActive = status === 'active';
          const isCompleted = status === 'completed';
          const isWaiting = status === 'waiting';
          const labels = getAgentLabels(agent.id, locale);
          
          return (
            <div
              key={agent.id}
              className={cn(
                'rounded-lg p-3 transition-all duration-300',
                isActive && 'bg-amber-500/20 border border-amber-500/50 animate-pulse',
                isCompleted && 'bg-green-500/15 border border-green-500/50',
                isWaiting && 'bg-muted/50 border border-transparent'
              )}
            >
              {/* Agent Number & Name */}
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold',
                    isActive && 'bg-amber-500 text-white',
                    isCompleted && 'bg-green-500 text-white',
                    isWaiting && 'bg-muted-foreground/30 text-muted-foreground'
                  )}
                >
                  {agent.number}
                </span>
                <span
                  className={cn(
                    'text-sm font-medium truncate',
                    isActive && 'text-amber-700 dark:text-amber-400',
                    isCompleted && 'text-green-700 dark:text-green-400',
                    isWaiting && 'text-muted-foreground'
                  )}
                >
                  {labels.shortName}
                </span>
              </div>
              
              {/* Status Lines */}
              <div className="ml-7">
                {isActive && (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="truncate">
                        {activeMessages?.line1 || labels.activeMessage}
                      </span>
                    </div>
                    {activeMessages?.line2 && (
                      <div className="text-xs text-amber-700/70 dark:text-amber-400/70 truncate pl-4">
                        {activeMessages.line2}
                      </div>
                    )}
                  </div>
                )}
                
                {isCompleted && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>
                      {agent.id === 'publishing' 
                        ? t('agent.publishing.done', locale)
                        : t('editor.completed', locale)
                      }
                    </span>
                  </div>
                )}
                
                {isWaiting && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                    <Clock className="h-3 w-3" />
                    <span>{t('editor.waiting', locale)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
