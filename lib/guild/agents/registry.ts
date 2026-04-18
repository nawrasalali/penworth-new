/**
 * Guild Agents Registry — single source of truth.
 *
 * Drives three things at once so they stay in sync:
 *   1. The 4 stub API routes (scout/coach/creator/advisor) read `status` from
 *      this registry to return a consistent 501 shape when the probation gate
 *      passes.
 *   2. The frontend agent cards read `status` to render "Available" vs
 *      "Coming soon" badges.
 *   3. Future activation of any coming-soon agent is a one-line registry flip
 *      (`status: 'coming_soon'` → `'live'`) plus writing the real agent logic —
 *      no other files need to learn about the new agent.
 *
 * `position` is the display order on the Agents page. Change only if the
 * product copy on /guild/agents is re-ordered.
 */

export const GUILD_AGENTS = {
  scout:      { status: 'coming_soon', position: 1 },
  coach:      { status: 'coming_soon', position: 2 },
  creator:    { status: 'coming_soon', position: 3 },
  mentor:     { status: 'live',        position: 4 },
  analyst:    { status: 'live',        position: 5 },
  strategist: { status: 'live',        position: 6 },
  advisor:    { status: 'coming_soon', position: 7 },
} as const;

export type GuildAgentName = keyof typeof GUILD_AGENTS;
export type GuildAgentStatus = (typeof GUILD_AGENTS)[GuildAgentName]['status'];

export function isLiveAgent(name: string): name is GuildAgentName {
  return name in GUILD_AGENTS && GUILD_AGENTS[name as GuildAgentName].status === 'live';
}
