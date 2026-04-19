/**
 * Canonical Nora Tier 1 tool names — single source of truth for what
 * values the `auto_fix_tool` column on nora_known_issues may hold.
 * Used by:
 *   - admin/known-issues editor (validates on save)
 *   - the known-issue matcher (dispatches to findTool() by name)
 *
 * Name drift fix, Phase 2.5 Commit 7 (known-issue matcher):
 *   Phase 2 originally hardcoded a legacy list of shortened names
 *   (password_reset, resend_email_verify, resend_invoice,
 *    check_subscription, open_ticket, fraud_flag_status) based on the
 *   brief's enumeration. The canonical Nora system prompt delivered
 *   by the founder at Commit 4 uses longer descriptive names. Commit
 *   5's tool registry honors the canonical names. This file is now
 *   updated to match. 5 of 8 names changed; 3 are unchanged
 *   (refresh_session, check_payout_status).
 *
 * Consequence for existing nora_known_issues rows:
 *   Any rows authored during Phase 2 with legacy auto_fix_tool values
 *   will fall through gracefully — the matcher calls findTool() which
 *   returns undefined, and the auto-fix dispatch is skipped. The
 *   pattern + playbook still return, so Nora can reason over them;
 *   she just can't one-click the fix. Non-breaking.
 *
 *   Any rows seeded by the verification chat's migration should be
 *   audited for legacy values; migrate to canonical as a follow-up.
 *
 * Invariant:
 *   lib/nora/tools/index.ts NORA_TOOLS is the definitive registry.
 *   If this array and NORA_TOOLS drift, the admin editor will refuse
 *   to save rows referencing a tool not present in both. Keep them
 *   aligned.
 */
export const NORA_TIER_1_TOOL_NAMES = [
  'trigger_password_reset',
  'resend_email_confirmation',
  'resend_last_invoice',
  'refresh_session',
  'check_payout_status',
  'check_subscription_status',
  'open_support_ticket',
  'get_fraud_flag_status',
] as const;

export type NoraTierOneToolName = typeof NORA_TIER_1_TOOL_NAMES[number];
