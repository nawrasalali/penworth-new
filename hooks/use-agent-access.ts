'use client';

import { useEffect, useState } from 'react';

export interface GuildMeResponse {
  is_member: boolean;
  status: 'active' | 'probation' | 'terminated' | 'resigned' | null;
  probation_reason: string | null;
  deferred_balance: number;
  can_use_agents: boolean;
  tier: string | null;
}

export interface UseAgentAccessResult extends GuildMeResponse {
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook: useAgentAccess
 *
 * Fetches the caller's Guild member state from /api/guild/me and returns the
 * data needed to render the probation banner and gate agent UIs on the client.
 *
 * Usage:
 *   const { loading, can_use_agents, deferred_balance, status } = useAgentAccess();
 *   if (loading) return <Skeleton />;
 *   if (!can_use_agents) return <ProbationBanner variant="full" />;
 *   return <AgentUI />;
 *
 * The API endpoint is authenticated server-side. The hook does not implement
 * its own auth; if the caller is unauthenticated the fetch returns 401 and
 * the hook reports `error`.
 *
 * Caching: the response is re-fetched on mount and when `refetch()` is
 * called (e.g. after the member clears their deferred balance via Stripe
 * and we want to re-check whether probation was lifted). No background
 * refresh; short-lived UI state.
 */
export function useAgentAccess(): UseAgentAccessResult {
  const [state, setState] = useState<GuildMeResponse>({
    is_member: false,
    status: null,
    probation_reason: null,
    deferred_balance: 0,
    can_use_agents: false,
    tier: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/guild/me', { method: 'GET', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json()) as GuildMeResponse | { error: string };
        if (!res.ok) {
          throw new Error(
            'error' in body && typeof body.error === 'string'
              ? body.error
              : `Request failed (${res.status})`,
          );
        }
        return body as GuildMeResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setState(data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? 'Unknown error');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refetchToken]);

  return {
    ...state,
    loading,
    error,
    refetch: () => setRefetchToken((t) => t + 1),
  };
}
