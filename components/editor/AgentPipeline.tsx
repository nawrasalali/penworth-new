'use client';

import { AGENTS, AgentName, AgentStatusMap, getAgentLabels } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';
import { t, type Locale } from '@/lib/i18n/strings';

interface AgentPipelineProps {
  currentAgent: AgentName;
  agentStatus: AgentStatusMap;
  activeMessages?: { line1: string; line2: string };
  locale?: Locale;
  /**
   * When true, omits the outer panel chrome (heading, border-r, bg) so this
   * component can be embedded inside another panel that owns those styles.
   * Used by the merged Project+Agents sidebar on the editor page.
   */
  embedded?: boolean;
}

export function AgentPipeline({
  currentAgent,
  agentStatus,
  activeMessages,
  locale = 'en',
  embedded = false,
}: AgentPipelineProps) {
  const list = (
    <div className="space-y-1">
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
              'rounded-md px-2 py-1.5 transition-colors duration-200 relative',
              /* Ambient active state: soft amber background at low opacity
                 (not the 20% alert-red-ish tone we had before), with a
                 border that slowly breathes 50%↔100% over 3s. Border only,
                 not bg — backgrounds that breathe feel like a notification
                 badge. */
              isActive && 'bg-amber-500/[0.06] border border-amber-500/40 animate-breathe',
              isCompleted && 'bg-green-500/10 border border-green-500/30',
              isWaiting && 'border border-transparent',
            )}
          >
            {/* Row 1: number + name + inline status indicator */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0',
                  isActive && 'bg-amber-500/80 text-white',
                  isCompleted && 'bg-green-500 text-white',
                  isWaiting && 'bg-muted-foreground/25 text-muted-foreground',
                )}
              >
                {agent.number}
              </span>
              <span
                className={cn(
                  'text-xs font-medium truncate flex-1',
                  isActive && 'text-amber-700 dark:text-amber-400',
                  isCompleted && 'text-green-700 dark:text-green-400',
                  isWaiting && 'text-muted-foreground',
                )}
              >
                {labels.shortName}
              </span>
              {/* Ambient pulse dot for active — NOT a spinner. Spinners
                  at 1s rotation read as "loading, please wait briefly";
                  a 3s scale cycle reads as "still thinking, you can look
                  away". Matches Perplexity's working-state ambient dot. */}
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse-dot shrink-0" />
              )}
              {isCompleted && <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />}
            </div>

            {/* Row 2 (active only): live status message. Waiting + completed
                agents get no second line — the row-1 affordances suffice. */}
            {isActive && activeMessages?.line1 && (
              <div className="pl-6 mt-0.5 text-[11px] text-amber-700/70 dark:text-amber-400/70 truncate">
                {activeMessages.line1}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (embedded) {
    return (
      <div className="p-3">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {t('editor.agentPipeline', locale)}
        </h3>
        {list}
      </div>
    );
  }

  return (
    <div className="w-[200px] shrink-0 border-r bg-muted/20 p-3 overflow-y-auto">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {t('editor.agentPipeline', locale)}
      </h2>
      {list}
    </div>
  );
}
