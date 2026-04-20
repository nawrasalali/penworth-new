/**
 * Phase 2.5 Item 3 — shared Nora types.
 *
 * Single source of truth for the shapes that cross module boundaries:
 * the member-context row from v_nora_member_context (with the
 * primary_language/preferred_language alias resolved), surface + role
 * enums, tool tiers, and the tool-result envelope every tool returns.
 */

// -----------------------------------------------------------------------------
// Surface + role enums
// -----------------------------------------------------------------------------

/**
 * Surface corresponds to where the widget is mounted. nora_conversations.
 * surface CHECK is (author|guild|store|admin). Per A7 the store surface
 * is out of scope for this repo — the store codebase lives in
 * penworth-store. Admin surface is deliberately kept: an admin viewing
 * /admin/* pages gets Nora with runbook access.
 */
export type NoraSurface = 'author' | 'guild' | 'store' | 'admin';

/**
 * Role enum from the prompt. Matches nora_conversations.user_role CHECK
 * enum in prod (10 values). store_reader / store_author are retained for
 * schema compatibility even though widget mount on the store surface
 * is deferred.
 */
export type NoraUserRole =
  | 'author_free'
  | 'author_pro'
  | 'author_max'
  | 'guildmember_active'
  | 'guildmember_probation'
  | 'guildmember_emeritus'
  | 'store_reader'
  | 'store_author'
  | 'admin'
  | 'super_admin';

// -----------------------------------------------------------------------------
// Member context — the shape the prompt sees
// -----------------------------------------------------------------------------

/**
 * Canonical Nora context shape. Built from v_nora_member_context (35
 * columns) plus computed fields. Field names match the SYSTEM_PROMPT
 * verbatim — so primary_language, not preferred_language (aliased in
 * buildNoraContext()).
 *
 * Nullable fields are explicitly typed — users who aren't Guildmembers
 * have every guild_* field null.
 */
export interface NoraContext {
  // Identity (always present)
  user_id: string;
  email: string;
  /** Aliased from v_nora_member_context.preferred_language per founder prompt. */
  primary_language: string;
  full_name: string | null;
  plan: string | null;
  is_admin: boolean;
  credits_balance: number | null;
  account_created_at: string;

  // Session (derived)
  surface: NoraSurface;
  user_role: NoraUserRole;

  // Guild state (null if not a Guildmember)
  guildmember_id: string | null;
  tier: string | null;
  guild_status: string | null;
  referral_code: string | null;
  guild_joined_at: string | null;
  primary_market: string | null;

  // Fee posture (Guildmembers only)
  account_fee_starts_at: string | null;
  fee_window_active: boolean | null;
  probation_started_at: string | null;
  probation_reason: string | null;
  deferred_balance_usd: number | null;
  current_monthly_fee_usd: number | null;

  // Referrals (Guildmembers only)
  total_referrals: number | null;
  retained_referrals: number | null;
  referrals_in_gate_window: number | null;

  // Payouts (Guildmembers only)
  last_payout: Record<string, unknown> | null;
  pending_commission_usd: number | null;

  // Grants (Guildmembers only)
  unused_grants: number | null;
  unused_grant_categories: string[] | null;

  // Mentor (Guildmembers only)
  completed_mentor_sessions: number | null;
  last_completed_mentor_session: Record<string, unknown> | null;
  next_scheduled_mentor_session: Record<string, unknown> | null;

  // Academy (Guildmembers only)
  mandatory_modules_completed: number | null;
  mandatory_modules_total: number | null;

  // Flags
  open_fraud_flags: number | null;
  open_support_tickets: number | null;

  // Recent activity
  nora_conversations_last_30d: number | null;
}

// -----------------------------------------------------------------------------
// Tool tiers per prompt
// -----------------------------------------------------------------------------

export type NoraToolTier = 1 | 2 | 3;

/**
 * Every tool returns this envelope. Keeping the shape uniform means the
 * turn loop can treat every tool result with identical plumbing —
 * serialise to the Anthropic tool_result content block, log to
 * nora_actions, surface `message_for_user` if present.
 */
export interface NoraToolResult {
  /** True if the tool completed its intended action. Failure modes
   *  (wrong tier, missing data, downstream error) all return ok=false. */
  ok: boolean;
  /**
   * Human-readable string Nora can render verbatim. Tools produce this
   * so wording lives next to the action rather than in the LLM's head.
   * The LLM is still free to paraphrase, but the canonical copy is here.
   */
  message_for_user?: string;
  /** Tool-specific structured payload for Nora to reason over. */
  data?: Record<string, unknown>;
  /** When ok=false — why. Surfaces in audit, not to user by default. */
  failure_reason?: string;
  /**
   * refresh_session uses this to tell the widget client to reload.
   * Widget checks for action === 'client_refresh_required'.
   */
  action?: 'client_refresh_required';
}

/**
 * Context the tool receives when invoked. Builds on NoraContext plus the
 * conversation-scoped state tools need (matched pattern for ticket
 * context, conversation id for back-references).
 */
export interface NoraToolContext {
  member: NoraContext;
  conversation_id: string;
  /** Whatever known_issues pattern the matcher picked, if any. Tools
   *  like open_support_ticket use this to seed nora_diagnosis. */
  matched_pattern?: {
    id: string;
    pattern_slug: string;
    resolution_playbook: string | null;
  } | null;
  /**
   * UUID of the nora_turns row with role='tool_call' that persisted THIS
   * tool invocation. Populated by the turn route after inserting the
   * tool_call row and before calling the handler.
   *
   * Used by Tier 2 tools when emitting an undo token — nora_tool_undo_tokens
   * has a FK forward_turn_id → nora_turns(id), so the token row needs a
   * real turn id to reference. Without this field, Tier 2 tools couldn't
   * satisfy the FK and would need a separate post-hoc query to find their
   * own row.
   *
   * Tier 1 tools can ignore this field — it's only relevant to tools that
   * emit undo tokens (Tier 2+). The shape is required (not optional) so
   * new tool writers can't forget to pass it when writing undo-emitting
   * tools; a `undefined` default would silently break undo-token INSERTs
   * under a FK violation that's hard to attribute.
   */
  forward_turn_id: string;
}

export interface NoraToolDefinition {
  name: string;
  tier: NoraToolTier;
  description: string;
  /** JSON Schema for the tool's input, matching the Anthropic tool API.
   *  Using `any` rather than importing Anthropic's types to keep this
   *  file dependency-light. */
  input_schema: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    ctx: NoraToolContext,
  ) => Promise<NoraToolResult>;
}
