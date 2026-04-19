import type { NoraToolDefinition } from '../types';

/**
 * Tier 1: request that the widget refresh the user's session client-side.
 *
 * The server cannot "refresh" a user's session — Supabase Auth tokens
 * live in browser storage. This tool therefore returns an action
 * directive (action='client_refresh_required') which the NoraWidget
 * consumes: show a toast and reload the page after a short delay.
 *
 * Use cases: subscription tier changed via Stripe webhook but the
 * client still has the old JWT; a role was granted admin-side.
 * Typically Nora would offer this after a related tool call that
 * invalidates cached client state.
 */
export const refreshSessionTool: NoraToolDefinition = {
  name: 'refresh_session',
  tier: 1,
  description:
    'Force the user\'s browser to refresh their session. Use after ' +
    'server-side account state changes that need to be reflected on ' +
    'the client (plan upgrade just took effect, role was granted, ' +
    'etc.). This causes the widget to reload the page — warn the user ' +
    'first so they can save any in-progress work.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_input, _ctx) => {
    return {
      ok: true,
      action: 'client_refresh_required',
      message_for_user:
        'Refreshing your session now. Any unsaved changes in the tab ' +
        'will be lost.',
    };
  },
};
