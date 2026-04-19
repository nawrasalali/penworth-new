import type { NoraToolDefinition } from '../types';

// Tier 1 — safe, self-executing after user confirmation
import { triggerPasswordResetTool } from './trigger-password-reset';
import { resendEmailConfirmationTool } from './resend-email-confirmation';
import { resendLastInvoiceTool } from './resend-last-invoice';
import { refreshSessionTool } from './refresh-session';
import { checkPayoutStatusTool } from './check-payout-status';
import { checkSubscriptionStatusTool } from './check-subscription-status';
import { openSupportTicketTool } from './open-support-ticket';
import { getFraudFlagStatusTool } from './get-fraud-flag-status';

/**
 * Phase 2.5 Item 3 Commit 5 — Tier 1 tool registry.
 *
 * Central export used by the /api/nora/conversation/turn route to build
 * the Anthropic tools array and to dispatch tool_use blocks to the
 * correct handler. Adding a tool means one import here + one line in
 * NORA_TOOLS.
 *
 * Tier 2 and Tier 3 tools are NOT in this registry — Tier 2 lives in
 * a forthcoming commit (explain-undo flow), Tier 3 drafts into the
 * admin approval queue rather than executing. Nora's prompt knows the
 * tier semantics; this registry is scoped to self-executing Tier 1.
 *
 * The prompt lists 9 Tier 1 names; we ship 8. `regenerate_api_key` is
 * deliberately dropped — grep across the repo confirms no target table
 * (no profiles.api_key column, no dedicated user-API-key table). The
 * prompt's BOUNDARIES block handles missing capability gracefully:
 * Nora says "I don't have that capability here — open a ticket."
 */
export const NORA_TOOLS: NoraToolDefinition[] = [
  triggerPasswordResetTool,
  resendEmailConfirmationTool,
  resendLastInvoiceTool,
  refreshSessionTool,
  checkPayoutStatusTool,
  checkSubscriptionStatusTool,
  openSupportTicketTool,
  getFraudFlagStatusTool,
];

/**
 * Build the Anthropic-API tools array. Consumed by the turn route when
 * constructing the messages.create() call. Kept here rather than in
 * the route so both the registry and the schema rendering live together.
 */
export function buildAnthropicToolsSpec() {
  return NORA_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}

/**
 * Lookup by name — O(n) but n is small (8). Used by the tool-use
 * dispatch loop in the turn route.
 */
export function findTool(name: string): NoraToolDefinition | undefined {
  return NORA_TOOLS.find((t) => t.name === name);
}

export type { NoraToolDefinition } from '../types';
