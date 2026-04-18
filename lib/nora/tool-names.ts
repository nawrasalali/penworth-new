/**
 * Phase 2 known-issue editor — hardcoded Nora Tier 1 tool names.
 *
 * Per pre-flight R1 default: when Nora ships in a later phase, the tool
 * registry will live in lib/nora/tools/index.ts and this list should
 * come from there. For now, no Nora code exists — we hardcode the
 * eight Tier 1 tool names the pre-flight brief enumerated (with A2's
 * 'regenerate_api_key' dropped — no target table exists).
 *
 * These names become auto_fix_tool values on nora_known_issues rows
 * authored today. When Nora's real tool registry lands, the validator
 * can either:
 *   (a) match these exact names, letting already-authored patterns
 *       wire up without migration, OR
 *   (b) reject unknown names and run a one-shot migration to rename
 *       the legacy values.
 *
 * Path (a) is the zero-migration path; we've chosen names that are
 * snake_case and self-descriptive to maximize the chance Path (a)
 * works unchanged.
 */
export const NORA_TIER_1_TOOL_NAMES = [
  'password_reset',
  'resend_email_verify',
  'resend_invoice',
  'refresh_session',
  'check_payout_status',
  'check_subscription',
  'open_ticket',
  'fraud_flag_status',
] as const;

export type NoraTierOneToolName = typeof NORA_TIER_1_TOOL_NAMES[number];
