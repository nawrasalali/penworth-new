/**
 * Phase 2.5 Item 3 Commit 11 — Nora unit tests.
 *
 * Coverage scope (pure logic only — no live Supabase / Anthropic):
 *   - tokenizeUserMessage           A12 tokenizer parity with DB regex
 *   - deriveUserRole                role precedence matrix
 *   - composeSystemPrompt           block presence + content wiring
 *   - NORA_SYSTEM_PROMPT            integrity markers
 *   - NORA_TOOLS registry           8-tool alignment, unique names,
 *                                   shape of every entry
 *   - NORA_TIER_1_TOOL_NAMES        alignment with NORA_TOOLS (the
 *                                   admin editor cares about this)
 *   - buildAnthropicToolsSpec       rendered shape
 *
 * Out of scope for this file (integration tests requiring mocks):
 *   - buildNoraContext against mocked Supabase
 *   - turn route Claude-loop orchestration
 *   - widget client rendering (would need jsdom + React testing)
 *
 * Those integration layers are exercised manually post-deploy and
 * tracked as follow-up coverage — the pure-logic surface caught here
 * is where regressions hide.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tokenizeUserMessage,
  type KnownIssuePattern,
} from '@/lib/nora/known-issue-matcher';
import {
  deriveUserRole,
  type MemberContextRow,
} from '@/lib/nora/context-builder';
import { composeSystemPrompt } from '@/lib/nora/compose-system-prompt';
import {
  NORA_SYSTEM_PROMPT,
  NORA_SYSTEM_PROMPT_WORD_COUNT,
} from '@/lib/nora/system-prompt';
import {
  NORA_TOOLS,
  buildAnthropicToolsSpec,
  findTool,
} from '@/lib/nora/tools';
import { NORA_TIER_1_TOOL_NAMES } from '@/lib/nora/tool-names';
import type { NoraContext, NoraSurface, NoraUserRole } from '@/lib/nora/types';

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

function baseRow(overrides: Partial<MemberContextRow> = {}): MemberContextRow {
  return {
    user_id: 'u-1',
    email: 'test@example.com',
    account_created_at: '2026-01-01T00:00:00Z',
    full_name: 'Test User',
    plan: 'free',
    credits_balance: 0,
    preferred_language: 'en',
    is_admin: false,
    payment_status: null,
    guildmember_id: null,
    tier: null,
    guild_status: null,
    referral_code: null,
    guild_joined_at: null,
    primary_market: null,
    account_fee_starts_at: null,
    fee_window_active: null,
    probation_started_at: null,
    probation_reason: null,
    deferred_balance_usd: null,
    current_monthly_fee_usd: null,
    total_referrals: null,
    retained_referrals: null,
    referrals_in_gate_window: null,
    last_payout: null,
    pending_commission_usd: null,
    unused_grants: null,
    unused_grant_categories: null,
    completed_mentor_sessions: null,
    last_completed_mentor_session: null,
    next_scheduled_mentor_session: null,
    mandatory_modules_completed: null,
    mandatory_modules_total: null,
    open_fraud_flags: null,
    open_support_tickets: null,
    nora_conversations_last_30d: null,
    ...overrides,
  };
}

function baseContext(overrides: Partial<NoraContext> = {}): NoraContext {
  return {
    user_id: 'u-1',
    email: 'test@example.com',
    primary_language: 'en',
    full_name: 'Test User',
    plan: 'free',
    is_admin: false,
    credits_balance: 0,
    account_created_at: '2026-01-01T00:00:00Z',
    surface: 'author',
    user_role: 'author_free',
    guildmember_id: null,
    tier: null,
    guild_status: null,
    referral_code: null,
    guild_joined_at: null,
    primary_market: null,
    account_fee_starts_at: null,
    fee_window_active: null,
    probation_started_at: null,
    probation_reason: null,
    deferred_balance_usd: null,
    current_monthly_fee_usd: null,
    total_referrals: null,
    retained_referrals: null,
    referrals_in_gate_window: null,
    last_payout: null,
    pending_commission_usd: null,
    unused_grants: null,
    unused_grant_categories: null,
    completed_mentor_sessions: null,
    last_completed_mentor_session: null,
    next_scheduled_mentor_session: null,
    mandatory_modules_completed: null,
    mandatory_modules_total: null,
    open_fraud_flags: null,
    open_support_tickets: null,
    nora_conversations_last_30d: null,
    ...overrides,
  };
}

function basePattern(overrides: Partial<KnownIssuePattern> = {}): KnownIssuePattern {
  return {
    id: 'p-1',
    pattern_slug: 'payout-delayed',
    title: 'Payout delayed',
    surface: 'guild',
    symptom_keywords: ['payout', 'missing', 'delayed'],
    diagnostic_sql: 'SELECT * FROM guild_payouts WHERE guildmember_id = :user_id LIMIT 3',
    resolution_playbook: 'Check guild_payouts status. If queued, wait for monthly run.',
    auto_fix_tool: 'check_payout_status',
    auto_fix_tier: 1,
    escalate_after_attempts: 2,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// tokenizeUserMessage — A12 tokenizer parity with DB regex
// -----------------------------------------------------------------------------

describe('tokenizeUserMessage', () => {
  it('lowercases input', () => {
    expect(tokenizeUserMessage('PAYOUT Missing')).toEqual(['payout', 'missing']);
  });

  it('strips punctuation to single spaces (matches DB regex)', () => {
    const tokens = tokenizeUserMessage("My payout didn't arrive. Where is it?");
    expect(tokens).toContain('payout');
    expect(tokens).toContain('didn');
    expect(tokens).toContain('t');
    expect(tokens).toContain('where');
    // No punctuation-bearing tokens
    for (const t of tokens) {
      expect(t).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('de-duplicates repeated words', () => {
    const tokens = tokenizeUserMessage('payout payout PAYOUT');
    expect(tokens).toEqual(['payout']);
  });

  it('filters empty strings from consecutive whitespace', () => {
    const tokens = tokenizeUserMessage('   spaced    out  words   ');
    expect(tokens).toEqual(['spaced', 'out', 'words']);
  });

  it('preserves digits (alphanumeric keywords)', () => {
    const tokens = tokenizeUserMessage('error 404 on page');
    expect(tokens).toEqual(expect.arrayContaining(['error', '404', 'on', 'page']));
  });

  it('returns empty array for empty / null-ish inputs', () => {
    expect(tokenizeUserMessage('')).toEqual([]);
    // @ts-expect-error — deliberately testing defensive path
    expect(tokenizeUserMessage(null)).toEqual([]);
    // @ts-expect-error — deliberately testing defensive path
    expect(tokenizeUserMessage(undefined)).toEqual([]);
  });

  it('handles unicode punctuation by dropping to spaces', () => {
    const tokens = tokenizeUserMessage("I'm confused — why is it stuck?");
    expect(tokens).toContain('i');
    expect(tokens).toContain('m');
    expect(tokens).toContain('confused');
    expect(tokens).toContain('why');
    expect(tokens).toContain('stuck');
    // The em-dash and apostrophe should have been stripped cleanly
    expect(tokens.join(' ')).not.toMatch(/—|'/);
  });
});

// -----------------------------------------------------------------------------
// deriveUserRole — role precedence matrix
// -----------------------------------------------------------------------------

describe('deriveUserRole', () => {
  it('admin flag wins over everything', () => {
    const row = baseRow({
      is_admin: true,
      plan: 'free',
      guildmember_id: 'gm-1',
      guild_status: 'active',
    });
    expect(deriveUserRole(row, 'author')).toBe('admin');
    expect(deriveUserRole(row, 'guild')).toBe('admin');
    expect(deriveUserRole(row, 'admin')).toBe('admin');
  });

  it('maps active guildmember to guildmember_active', () => {
    const row = baseRow({
      guildmember_id: 'gm-1',
      guild_status: 'active',
      plan: 'pro',
    });
    expect(deriveUserRole(row, 'guild')).toBe('guildmember_active');
  });

  it('maps probation guildmember to guildmember_probation', () => {
    const row = baseRow({
      guildmember_id: 'gm-1',
      guild_status: 'probation',
    });
    expect(deriveUserRole(row, 'guild')).toBe('guildmember_probation');
  });

  it('maps emeritus guildmember to guildmember_emeritus', () => {
    const row = baseRow({
      guildmember_id: 'gm-1',
      guild_status: 'emeritus',
    });
    expect(deriveUserRole(row, 'guild')).toBe('guildmember_emeritus');
  });

  it('maps agency plan to author_max', () => {
    const row = baseRow({ plan: 'agency' });
    expect(deriveUserRole(row, 'author')).toBe('author_max');
  });

  it('maps publisher plan to author_max', () => {
    const row = baseRow({ plan: 'publisher' });
    expect(deriveUserRole(row, 'author')).toBe('author_max');
  });

  it('maps pro plan to author_pro', () => {
    const row = baseRow({ plan: 'pro' });
    expect(deriveUserRole(row, 'author')).toBe('author_pro');
  });

  it('maps starter plan to author_pro', () => {
    const row = baseRow({ plan: 'starter' });
    expect(deriveUserRole(row, 'author')).toBe('author_pro');
  });

  it('falls through to author_free for unknown / free plans', () => {
    expect(deriveUserRole(baseRow({ plan: 'free' }), 'author')).toBe('author_free');
    expect(deriveUserRole(baseRow({ plan: null }), 'author')).toBe('author_free');
    expect(deriveUserRole(baseRow({ plan: 'hobbyist' }), 'author')).toBe('author_free');
  });

  it('is case-insensitive on plan names', () => {
    expect(deriveUserRole(baseRow({ plan: 'AGENCY' }), 'author')).toBe('author_max');
    expect(deriveUserRole(baseRow({ plan: 'Pro' }), 'author')).toBe('author_pro');
  });

  it('prefers guildmember role over author plan when both present', () => {
    const row = baseRow({
      guildmember_id: 'gm-1',
      guild_status: 'active',
      plan: 'agency',
    });
    expect(deriveUserRole(row, 'guild')).toBe('guildmember_active');
  });

  it('does not return admin when guildmember is terminated (upstream filter responsibility)', () => {
    // The mount guard filters terminated/resigned upstream. If deriveUserRole
    // sees one, it falls through to author_* — which is fine because the
    // context builder would have rejected the row before calling here.
    const row = baseRow({
      guildmember_id: 'gm-1',
      guild_status: 'terminated',
      plan: 'free',
    });
    // Not one of the mapped guild statuses → falls through to plan → free
    expect(deriveUserRole(row, 'guild')).toBe('author_free');
  });
});

// -----------------------------------------------------------------------------
// composeSystemPrompt — block presence + content wiring
// -----------------------------------------------------------------------------

describe('composeSystemPrompt', () => {
  it('includes the canonical NORA_SYSTEM_PROMPT verbatim as the prefix', () => {
    const out = composeSystemPrompt(baseContext(), null);
    expect(out.startsWith(NORA_SYSTEM_PROMPT)).toBe(true);
  });

  it('appends injected session context block', () => {
    const ctx = baseContext({ email: 'author@example.com', plan: 'pro' });
    const out = composeSystemPrompt(ctx, null);
    expect(out).toContain('INJECTED SESSION CONTEXT');
    expect(out).toContain('author@example.com');
    expect(out).toContain('plan: pro');
  });

  it('shows "Not a Guild member" for non-guild users', () => {
    const out = composeSystemPrompt(baseContext(), null);
    expect(out).toContain('Not a Guild member');
  });

  it('includes Guild state block when guildmember_id is present', () => {
    const ctx = baseContext({
      guildmember_id: 'gm-1',
      tier: 'artisan',
      guild_status: 'active',
      user_role: 'guildmember_active',
      surface: 'guild',
      total_referrals: 5,
      retained_referrals: 3,
    });
    const out = composeSystemPrompt(ctx, null);
    expect(out).toContain('Guild state:');
    expect(out).toContain('tier: artisan');
    expect(out).toContain('total_referrals: 5');
    expect(out).toContain('retained_referrals: 3');
  });

  it('omits the known-issue block when no pattern matched', () => {
    const out = composeSystemPrompt(baseContext(), null);
    expect(out).not.toContain('KNOWN-ISSUE PATTERN MATCHED');
  });

  it('appends the known-issue block when a pattern matched', () => {
    const out = composeSystemPrompt(baseContext(), basePattern());
    expect(out).toContain('KNOWN-ISSUE PATTERN MATCHED');
    expect(out).toContain('pattern_slug: payout-delayed');
    expect(out).toContain('title: Payout delayed');
    expect(out).toContain('auto_fix_tool: check_payout_status (tier 1)');
    expect(out).toContain('guild_payouts'); // from playbook text
  });

  it('handles pattern with no auto_fix_tool cleanly', () => {
    const pat = basePattern({ auto_fix_tool: null, auto_fix_tier: null });
    const out = composeSystemPrompt(baseContext(), pat);
    expect(out).toContain('pattern_slug: payout-delayed');
    expect(out).not.toContain('auto_fix_tool: null');
    expect(out).not.toMatch(/auto_fix_tool: undefined/);
  });

  it('handles pattern with null playbook text', () => {
    const pat = basePattern({ resolution_playbook: null });
    const out = composeSystemPrompt(baseContext(), pat);
    expect(out).toContain('(no playbook text on file)');
  });
});

// -----------------------------------------------------------------------------
// NORA_SYSTEM_PROMPT — integrity markers
// -----------------------------------------------------------------------------

describe('NORA_SYSTEM_PROMPT integrity', () => {
  it('is a non-empty string', () => {
    expect(typeof NORA_SYSTEM_PROMPT).toBe('string');
    expect(NORA_SYSTEM_PROMPT.length).toBeGreaterThan(1000);
  });

  it('matches a reasonable word count window (integrity guard)', () => {
    // Guards against accidental truncation. The measured count at
    // authoring time is ~1750 words; bounds are wide enough to absorb
    // editing but tight enough to catch a stray regex replace or a
    // copy-paste losing a whole section.
    expect(NORA_SYSTEM_PROMPT_WORD_COUNT).toBeGreaterThan(1500);
    expect(NORA_SYSTEM_PROMPT_WORD_COUNT).toBeLessThan(3000);
  });

  it('contains the identity section with Nora name', () => {
    expect(NORA_SYSTEM_PROMPT).toMatch(/═══ IDENTITY ═══/);
    expect(NORA_SYSTEM_PROMPT).toMatch(/Your name is Nora\./);
  });

  it('declares the three surfaces per the founder prompt', () => {
    // Prompt says "three surfaces" — schema has four (admin added),
    // but the prompt text must stay verbatim. If someone changes
    // "three" to "four" the test catches it.
    expect(NORA_SYSTEM_PROMPT).toMatch(/three surfaces/);
  });

  it('contains the Tier 1 / Tier 2 / Tier 3 tool ladder', () => {
    expect(NORA_SYSTEM_PROMPT).toMatch(/TIER 1/);
    expect(NORA_SYSTEM_PROMPT).toMatch(/TIER 2/);
    expect(NORA_SYSTEM_PROMPT).toMatch(/TIER 3/);
  });

  it('contains the auto-troubleshoot flow + escalation rules', () => {
    expect(NORA_SYSTEM_PROMPT).toMatch(/AUTO-TROUBLESHOOT FLOW/);
    expect(NORA_SYSTEM_PROMPT).toMatch(/ESCALATION RULES/);
  });

  it('contains all 9 Tier 1 tool names from the founder spec', () => {
    // The prompt lists 9 names; Commit 5's registry ships 8
    // (regenerate_api_key dropped). But the PROMPT TEXT still lists
    // all 9 — that's the contract with Nora's internal reasoning.
    // Test both the prompt and the registry here.
    const promptNames = [
      'trigger_password_reset',
      'resend_email_confirmation',
      'resend_last_invoice',
      'refresh_session',
      'check_payout_status',
      'check_subscription_status',
      'regenerate_api_key',
      'open_support_ticket',
      'get_fraud_flag_status',
    ];
    for (const name of promptNames) {
      expect(NORA_SYSTEM_PROMPT).toContain(name);
    }
  });
});

// -----------------------------------------------------------------------------
// NORA_TOOLS registry invariants
// -----------------------------------------------------------------------------

describe('NORA_TOOLS registry', () => {
  it('contains exactly 8 tools (regenerate_api_key deliberately dropped)', () => {
    expect(NORA_TOOLS).toHaveLength(8);
  });

  it('every tool has a unique name', () => {
    const names = NORA_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool is Tier 1', () => {
    for (const tool of NORA_TOOLS) {
      expect(tool.tier).toBe(1);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of NORA_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('every tool has a valid input_schema (object with properties)', () => {
    for (const tool of NORA_TOOLS) {
      expect(tool.input_schema).toHaveProperty('type', 'object');
      expect(tool.input_schema).toHaveProperty('properties');
    }
  });

  it('every tool has an async handler', () => {
    for (const tool of NORA_TOOLS) {
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('ships the 8 canonical names from the founder prompt (minus regenerate_api_key)', () => {
    const names = NORA_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'check_payout_status',
        'check_subscription_status',
        'get_fraud_flag_status',
        'open_support_ticket',
        'refresh_session',
        'resend_email_confirmation',
        'resend_last_invoice',
        'trigger_password_reset',
      ].sort(),
    );
  });

  it('does NOT ship regenerate_api_key (no target table exists)', () => {
    expect(findTool('regenerate_api_key')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// NORA_TIER_1_TOOL_NAMES alignment with registry
// -----------------------------------------------------------------------------

describe('NORA_TIER_1_TOOL_NAMES alignment', () => {
  it('matches the registry exactly (admin editor relies on this)', () => {
    const registryNames = [...NORA_TOOLS.map((t) => t.name)].sort();
    const listedNames = [...NORA_TIER_1_TOOL_NAMES].sort();
    expect(listedNames).toEqual(registryNames);
  });

  it('contains the 5 canonicalized names from the Phase 2.5 rename', () => {
    // Phase 2 had: password_reset, resend_email_verify, resend_invoice,
    //              check_subscription, open_ticket, fraud_flag_status
    // Commit 7 canonicalized to longer descriptive names.
    expect(NORA_TIER_1_TOOL_NAMES).toContain('trigger_password_reset');
    expect(NORA_TIER_1_TOOL_NAMES).toContain('resend_email_confirmation');
    expect(NORA_TIER_1_TOOL_NAMES).toContain('resend_last_invoice');
    expect(NORA_TIER_1_TOOL_NAMES).toContain('check_subscription_status');
    expect(NORA_TIER_1_TOOL_NAMES).toContain('open_support_ticket');
    expect(NORA_TIER_1_TOOL_NAMES).toContain('get_fraud_flag_status');
  });

  it('does NOT contain legacy Phase 2 names', () => {
    const legacy = [
      'password_reset',
      'resend_email_verify',
      'resend_invoice',
      'check_subscription',
      'open_ticket',
      'fraud_flag_status',
    ];
    for (const name of legacy) {
      expect(NORA_TIER_1_TOOL_NAMES).not.toContain(name);
    }
  });
});

// -----------------------------------------------------------------------------
// buildAnthropicToolsSpec — rendered shape for the Anthropic SDK
// -----------------------------------------------------------------------------

describe('buildAnthropicToolsSpec', () => {
  it('returns one entry per tool', () => {
    const spec = buildAnthropicToolsSpec();
    expect(spec).toHaveLength(NORA_TOOLS.length);
  });

  it('each entry has exactly {name, description, input_schema}', () => {
    const spec = buildAnthropicToolsSpec();
    for (const entry of spec) {
      const keys = Object.keys(entry).sort();
      expect(keys).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('does NOT include handler or tier in the rendered spec', () => {
    const spec = buildAnthropicToolsSpec() as unknown as Array<Record<string, unknown>>;
    for (const entry of spec) {
      expect(entry).not.toHaveProperty('handler');
      expect(entry).not.toHaveProperty('tier');
    }
  });
});

// -----------------------------------------------------------------------------
// findTool lookup
// -----------------------------------------------------------------------------

describe('findTool lookup', () => {
  it('returns the tool for every canonical name', () => {
    for (const name of NORA_TIER_1_TOOL_NAMES) {
      expect(findTool(name)).toBeDefined();
      expect(findTool(name)?.name).toBe(name);
    }
  });

  it('returns undefined for unknown names', () => {
    expect(findTool('not_a_real_tool')).toBeUndefined();
    expect(findTool('')).toBeUndefined();
  });

  it('returns undefined for legacy Phase 2 names (drift check)', () => {
    // If a nora_known_issues row in prod still carries a legacy name,
    // findTool gracefully returns undefined and the auto-fix dispatch
    // is skipped. This test locks that behaviour in.
    expect(findTool('password_reset')).toBeUndefined();
    expect(findTool('resend_invoice')).toBeUndefined();
    expect(findTool('open_ticket')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Surface + role type coverage (compile-time check via explicit assign)
// -----------------------------------------------------------------------------

describe('NoraSurface / NoraUserRole enumeration', () => {
  it('NoraSurface includes exactly 4 values', () => {
    const surfaces: NoraSurface[] = ['author', 'guild', 'store', 'admin'];
    expect(surfaces).toHaveLength(4);
  });

  it('NoraUserRole includes all 10 documented values', () => {
    const roles: NoraUserRole[] = [
      'author_free',
      'author_pro',
      'author_max',
      'guildmember_active',
      'guildmember_probation',
      'guildmember_emeritus',
      'store_reader',
      'store_author',
      'admin',
      'super_admin',
    ];
    expect(roles).toHaveLength(10);
  });
});

// -----------------------------------------------------------------------------
// Commit 12 — turn-row-builders: role-split persistence shapes
// -----------------------------------------------------------------------------
//
// Prod schema's nora_turns.role CHECK enum is ('user', 'assistant',
// 'tool_call', 'tool_result', 'system_note'). The brief's original
// design packed tool calls into a tool_calls JSONB on a single
// assistant row — that column doesn't exist. Each tool invocation
// produces three DB rows (assistant, tool_call, tool_result). These
// tests assert the row shapes are correct before the route persists
// them — if the shape drifts, the INSERT 400s in prod.

import {
  buildAssistantTurnRow,
  buildToolCallRow,
  buildToolResultRow,
  computeTurnIndicesForIteration,
} from '@/lib/nora/turn-row-builders';

describe('Commit 12 — nora_turns row shapes', () => {
  it('assistant row: model_used + token counts + matched_pattern_id on first iteration', () => {
    const row = buildAssistantTurnRow({
      conversation_id: 'c1',
      turn_index: 3,
      content: 'Resetting password now.',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 120,
      outputTokens: 40,
      isFirstIteration: true,
      matchedPatternId: 'pat-1',
    });
    expect(row.role).toBe('assistant');
    expect(row.content).toBe('Resetting password now.');
    expect(row.model_used).toBe('claude-haiku-4-5-20251001');
    expect(row.input_tokens).toBe(120);
    expect(row.output_tokens).toBe(40);
    expect(row.matched_pattern_id).toBe('pat-1');
    // Must NOT carry tool fields — those live on their own rows
    expect((row as unknown as Record<string, unknown>).tool_name).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).tool_input).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).tool_output).toBeUndefined();
  });

  it('assistant row: matched_pattern_id is NULL on non-first iteration', () => {
    // Prevents over-counting in resolution_success_rate. Only the first
    // iteration of a Claude tool-use loop should be treated as the
    // "pattern match origin" turn.
    const row = buildAssistantTurnRow({
      conversation_id: 'c1',
      turn_index: 5,
      content: 'Follow-up after tool result.',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 200,
      outputTokens: 25,
      isFirstIteration: false,
      matchedPatternId: 'pat-1', // same pattern, but this is iter 2+
    });
    expect(row.matched_pattern_id).toBeNull();
  });

  it('tool_call row: tool_name + tool_input present, content explicitly null', () => {
    const row = buildToolCallRow({
      conversation_id: 'c1',
      turn_index: 4,
      toolName: 'trigger_password_reset',
      toolInput: { user_email: 'x@y.z' },
    });
    expect(row.role).toBe('tool_call');
    expect(row.tool_name).toBe('trigger_password_reset');
    expect(row.tool_input).toEqual({ user_email: 'x@y.z' });
    // Explicit null, not undefined — ensures INSERT sends NULL rather
    // than omitting the field (Supabase maps undefined to omitted).
    expect(row.content).toBeNull();
  });

  it('tool_result row: tool_output flattens is_error alongside envelope fields', () => {
    const row = buildToolResultRow({
      conversation_id: 'c1',
      turn_index: 5,
      toolName: 'trigger_password_reset',
      toolResult: {
        ok: true,
        message_for_user: 'Reset email sent to x@y.z',
        data: { link_sent_at: '2026-04-19T06:00:00Z' },
      },
    });
    expect(row.role).toBe('tool_result');
    expect(row.tool_name).toBe('trigger_password_reset');
    expect(row.content).toBeNull();
    expect(row.tool_output.is_error).toBe(false);
    expect(row.tool_output.ok).toBe(true);
    expect(row.tool_output.message_for_user).toBe('Reset email sent to x@y.z');
    // Admin UI queries against tool_output should find is_error at top
    // level without reaching into a nested object
    expect(Object.keys(row.tool_output)).toContain('is_error');
  });

  it('tool_result row: is_error=true when ok=false', () => {
    const row = buildToolResultRow({
      conversation_id: 'c1',
      turn_index: 5,
      toolName: 'check_payout_status',
      toolResult: {
        ok: false,
        failure_reason: 'no_payouts_found',
      },
    });
    expect(row.tool_output.is_error).toBe(true);
    expect(row.tool_output.ok).toBe(false);
    expect(row.tool_output.failure_reason).toBe('no_payouts_found');
  });

  it('computeTurnIndicesForIteration: 1 assistant + 2 tools yields 5 sequential indices (A, C1, R1, C2, R2)', () => {
    const indices = computeTurnIndicesForIteration({
      startIndex: 10,
      numAssistantRows: 1,
      numToolCalls: 2,
    });
    expect(indices).toEqual([10, 11, 12, 13, 14]);
  });

  it('computeTurnIndicesForIteration: 1 assistant + 0 tools yields single index', () => {
    const indices = computeTurnIndicesForIteration({
      startIndex: 7,
      numAssistantRows: 1,
      numToolCalls: 0,
    });
    expect(indices).toEqual([7]);
  });
});

// -----------------------------------------------------------------------------
// Commit 15 — fetchMemberContextViaRawFetch: raw PostgREST bypass
//
// Coverage for the helper that replaced supabase-js for the v_nora_member_context
// query after Commits 12-14 failed to force service-role via the library client.
// Tests confirm:
//   - URL is constructed exactly as PostgREST expects
//   - apikey + Authorization headers carry the service role key
//   - Zero rows returns null (no throw)
//   - One row returns the row unchanged
//   - HTTP !ok throws, with the raw-fetch-error log carrying diagnostic detail
//   - Missing env vars throws with a clear message
//
// We import the __test_ alias to make the intent visible: production code
// must not reach past buildNoraContext for this function.
// -----------------------------------------------------------------------------

import { __test_fetchMemberContextViaRawFetch } from '@/lib/nora/context-builder';

describe('fetchMemberContextViaRawFetch', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test_service_role_key_abc123';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('constructs the expected PostgREST URL, headers, and method', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify([baseRow({ user_id: 'user-xyz' })]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await __test_fetchMemberContextViaRawFetch('user-xyz');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    // URL: baseUrl + rest path + user_id filter + select=* + limit=1
    expect(calledUrl).toBe(
      'https://fake.supabase.co/rest/v1/v_nora_member_context' +
        '?user_id=eq.user-xyz&select=*&limit=1',
    );

    // Method + cache-control
    expect(calledInit.method).toBe('GET');
    expect(calledInit.cache).toBe('no-store');

    // Both apikey AND Authorization carry the service role key — PostgREST
    // accepts either, but we send both for belt-and-braces and to match
    // the headers @supabase/supabase-js would have sent if it were working.
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.apikey).toBe('sk_test_service_role_key_abc123');
    expect(headers.Authorization).toBe(
      'Bearer sk_test_service_role_key_abc123',
    );
    expect(headers.Accept).toBe('application/json');
  });

  it('url-encodes special characters in user_id (defence against path injection)', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await __test_fetchMemberContextViaRawFetch('user+with/weird?chars');

    const [calledUrl] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // encodeURIComponent encodes + / ? so a user_id can never escape the
    // query param and inject another filter
    expect(calledUrl).toContain(
      'user_id=eq.user%2Bwith%2Fweird%3Fchars',
    );
  });

  it('returns the first row when PostgREST returns a one-element array', async () => {
    const row = baseRow({ user_id: 'user-one', email: 'alpha@example.com' });
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify([row]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await __test_fetchMemberContextViaRawFetch('user-one');
    expect(result).toEqual(row);
  });

  it('returns null when PostgREST returns an empty array (zero rows matched)', async () => {
    global.fetch = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await __test_fetchMemberContextViaRawFetch('nobody');
    expect(result).toBeNull();
  });

  it('throws on HTTP !ok (covers the 42501 RLS case and any other PostgREST error)', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const errorBody = JSON.stringify({
      code: '42501',
      message: 'permission denied for table users',
      details: null,
      hint: null,
    });
    global.fetch = vi.fn(async () =>
      new Response(errorBody, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      __test_fetchMemberContextViaRawFetch('user-denied'),
    ).rejects.toThrow(/v_nora_member_context raw fetch failed: 403 Forbidden/);

    // Diagnostic log fires with all the right shape — verification chat
    // will be looking for this prefix if Commit 15 ever starts failing
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[nora:context-builder:raw-fetch-error]',
      expect.objectContaining({
        userId: 'user-denied',
        status: 403,
        statusText: 'Forbidden',
        body: expect.stringContaining('42501'),
      }),
    );
  });

  it('throws with a clear message when required env vars are missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      __test_fetchMemberContextViaRawFetch('user-any'),
    ).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required/,
    );
  });
});
