import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { MODEL_IDS } from '@/lib/ai/model-router';
import { buildNoraContext } from '@/lib/nora/context-builder';
import { composeSystemPrompt } from '@/lib/nora/compose-system-prompt';
import {
  matchKnownIssue,
} from '@/lib/nora/known-issue-matcher';
import {
  findTool,
  buildAnthropicToolsSpec,
} from '@/lib/nora/tools';
import type { NoraSurface, NoraToolContext } from '@/lib/nora/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Phase 2.5 Item 3 Commit 6 — POST /api/nora/conversation/turn.
 *
 * Drives one user-visible assistant reply. Wire diagram:
 *
 *     1  Auth user (cookie)
 *     2  Validate body { conversation_id, user_message }
 *     3  Load conversation row, check ownership + not closed
 *     4  RPC nora_consume_turn (per-user daily rate limit, 20/24h)
 *        └── allowed=false → 429 with retry-after + user message
 *     5  INSERT user turn
 *     6  buildNoraContext (fresh — state may have changed since /start)
 *     7  matchKnownIssue (best-effort — no throw on miss)
 *     8  Compose system prompt:
 *          NORA_SYSTEM_PROMPT + context block + matched_pattern block
 *     9  Load prior turns for conversation history
 *    10  Anthropic messages.create with Haiku + tools + history
 *    11  Tool-use loop (max 5 iters) — dispatch via findTool()
 *    12  INSERT assistant turn with final_text + tool_calls[]
 *    13  Return assistant_message + tool_calls + matched_pattern + usage
 *
 * Nora uses Haiku (claude-haiku-4-5-20251001) — support is
 * classification + tool-use + calibration, not long-form writing. Cost
 * per Nora turn is well under 2¢ at expected volumes.
 *
 * Known-issue diagnostic_sql execution is NOT in this commit. The
 * matched pattern's resolution_playbook (text) is passed to Nora as
 * context; she reasons over prose rather than live diagnostic output.
 * query_user_data tool + exec_sql RPC are follow-up work.
 */

const MAX_TOOL_USE_ITERATIONS = 5;
const MAX_TOKENS_PER_CALL = 2048;

export async function POST(request: NextRequest) {
  // --- 1. Auth -------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // --- 2. Body validation --------------------------------------------------
  let body: { conversation_id?: string; user_message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const conversationId = body.conversation_id;
  const userMessage = (body.user_message ?? '').trim();
  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json(
      { error: 'conversation_id required' },
      { status: 400 },
    );
  }
  if (!userMessage) {
    return NextResponse.json(
      { error: 'user_message required' },
      { status: 400 },
    );
  }
  if (userMessage.length > 8000) {
    // Prevent prompt-injection / abuse via megamessages. 8k chars is
    // generous for a support question.
    return NextResponse.json(
      { error: 'user_message too long (max 8000 characters)' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // --- 3. Load conversation + ownership check ------------------------------
  const { data: conversation, error: convErr } = await admin
    .from('nora_conversations')
    .select('id, user_id, surface, user_role, closed_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr) {
    console.error('[nora/turn] conversation fetch error:', convErr);
    return NextResponse.json(
      { error: 'conversation_fetch_failed' },
      { status: 500 },
    );
  }
  if (!conversation) {
    return NextResponse.json(
      { error: 'conversation_not_found' },
      { status: 404 },
    );
  }
  if (conversation.user_id !== user.id) {
    // 404 rather than 403 — don't leak that the conversation exists
    // under someone else's ownership.
    return NextResponse.json(
      { error: 'conversation_not_found' },
      { status: 404 },
    );
  }
  if (conversation.closed_at) {
    return NextResponse.json(
      {
        error: 'conversation_closed',
        message: 'This conversation is closed. Please start a new one.',
      },
      { status: 410 },
    );
  }

  const surface = conversation.surface as NoraSurface;

  // --- 4. Rate limit (nora_consume_turn RPC — live in prod, migration 018) -
  const { data: rateLimit, error: rateErr } = await admin.rpc(
    'nora_consume_turn',
    { p_user_id: user.id },
  );
  if (rateErr) {
    console.error('[nora/turn] nora_consume_turn RPC error:', rateErr);
    // Fail-open would be wrong here — the RPC existing is a guarantee.
    // If the call fails we can't safely proceed: user could spam Claude.
    return NextResponse.json(
      { error: 'rate_limit_check_failed' },
      { status: 503 },
    );
  }

  const rlResult = rateLimit as {
    allowed?: boolean;
    turns_today?: number;
    limit?: number;
    resets_at?: string;
    message?: string;
  } | null;

  if (!rlResult?.allowed) {
    const resetsAt = rlResult?.resets_at
      ? new Date(rlResult.resets_at).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    const retryAfterSecs = Math.max(1, Math.ceil((resetsAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: 'rate_limited',
        message:
          rlResult?.message ??
          "You've reached the daily Nora message limit. It resets in 24 hours.",
        turns_today: rlResult?.turns_today,
        limit: rlResult?.limit,
        resets_at: rlResult?.resets_at,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSecs) },
      },
    );
  }

  // --- 5. INSERT user turn -------------------------------------------------
  const { data: priorCount } = await admin
    .from('nora_turns')
    .select('turn_index', { count: 'exact', head: false })
    .eq('conversation_id', conversationId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIndex = (priorCount?.turn_index ?? -1) + 1;

  const { error: userTurnErr } = await admin.from('nora_turns').insert({
    conversation_id: conversationId,
    turn_index: nextIndex,
    role: 'user',
    content: userMessage,
  });
  if (userTurnErr) {
    console.error('[nora/turn] user turn insert failed:', userTurnErr);
    return NextResponse.json(
      { error: 'user_turn_persist_failed' },
      { status: 500 },
    );
  }

  // --- 6. Context (fresh every turn — state may have changed) --------------
  const ctxResult = await buildNoraContext({
    user_id: user.id,
    surface,
    admin,
  });
  if (!ctxResult.ok) {
    // Mid-conversation mount-guard failure. Unusual but possible if the
    // user is terminated between /start and /turn. Return 403 — client
    // should close the widget.
    return NextResponse.json(
      { error: 'nora_unavailable' },
      { status: 403 },
    );
  }
  const ctx = ctxResult.context;

  // --- 7. Known-issue match (non-fatal) ------------------------------------
  const { matched: matchedPattern } = await matchKnownIssue({
    admin,
    surface,
    message: userMessage,
  });

  // --- 8. System prompt composition ----------------------------------------
  const systemText = composeSystemPrompt(ctx, matchedPattern);

  // --- 9. Conversation history ---------------------------------------------
  // Load previous turns as plain text. We only send role:'user' and
  // role:'assistant' turns — skip 'tool_result' rows (those are stored
  // for audit only; in-context they'd reference tool_use IDs from a
  // PAST API call that no longer exist).
  const { data: priorTurns } = await admin
    .from('nora_turns')
    .select('turn_index, role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('turn_index', { ascending: true });

  const priorMessages: Anthropic.Messages.MessageParam[] = (priorTurns ?? [])
    .filter((t) => t.content) // skip empty
    // Don't re-send the just-inserted user message — it's already the
    // current turn. Drop turns with index === nextIndex.
    .filter((t) => t.turn_index !== nextIndex)
    .map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(t.content),
    }));

  // Append the current user message as the latest turn.
  const messages: Anthropic.Messages.MessageParam[] = [
    ...priorMessages,
    { role: 'user', content: userMessage },
  ];

  // --- 10-11. Anthropic call + tool-use loop -------------------------------
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('[nora/turn] ANTHROPIC_API_KEY missing');
    return NextResponse.json(
      { error: 'ai_not_configured' },
      { status: 503 },
    );
  }
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const toolSpecs = buildAnthropicToolsSpec();

  let finalText = '';
  const toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result: unknown;
  }> = [];
  let stopReason: string | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let clientActionRequired: 'client_refresh_required' | null = null;

  const toolCtx: NoraToolContext = {
    member: ctx,
    conversation_id: conversationId,
    matched_pattern: matchedPattern
      ? {
          id: matchedPattern.id,
          pattern_slug: matchedPattern.pattern_slug,
          resolution_playbook: matchedPattern.resolution_playbook,
        }
      : null,
  };

  try {
    for (let iter = 0; iter < MAX_TOOL_USE_ITERATIONS; iter++) {
      const response = await anthropic.messages.create({
        model: MODEL_IDS.haiku,
        max_tokens: MAX_TOKENS_PER_CALL,
        system: systemText,
        tools: toolSpecs as Anthropic.Messages.Tool[],
        messages,
      });
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      stopReason = response.stop_reason;

      // Record Claude's assistant turn verbatim
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter(
        (c) => c.type === 'tool_use',
      ) as Anthropic.Messages.ToolUseBlock[];
      const textBlocks = response.content.filter(
        (c) => c.type === 'text',
      ) as Anthropic.Messages.TextBlock[];

      // Capture any text Nora has produced this iteration. If the model
      // mixes text + tool_use, only the LAST iteration's text is
      // user-visible (the model will echo/recap in its final turn).
      if (textBlocks.length) {
        finalText = textBlocks.map((t) => t.text).join('\n');
      }

      if (!toolUses.length) {
        // No tool calls this iteration — Nora is done.
        break;
      }

      // Dispatch each tool_use in order
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const tool = findTool(use.name);
        if (!tool) {
          // Unknown tool — return an error result so Claude can apologise
          // in its next turn instead of crashing the loop.
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: `Unknown tool: ${use.name}`,
          });
          toolCalls.push({
            name: use.name,
            input: use.input as Record<string, unknown>,
            result: { error: 'unknown_tool' },
          });
          continue;
        }

        try {
          const result = await tool.handler(
            use.input as Record<string, unknown>,
            toolCtx,
          );
          toolCalls.push({
            name: use.name,
            input: use.input as Record<string, unknown>,
            result,
          });
          if (result.action === 'client_refresh_required') {
            clientActionRequired = 'client_refresh_required';
          }
          // Serialise result envelope to a JSON string for Claude
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: !result.ok,
            content: JSON.stringify({
              ok: result.ok,
              message_for_user: result.message_for_user,
              data: result.data,
              failure_reason: result.failure_reason,
            }),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[nora/turn] tool ${use.name} handler threw:`, err);
          toolCalls.push({
            name: use.name,
            input: use.input as Record<string, unknown>,
            result: { error: 'handler_exception', message: msg },
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: `Tool handler error: ${msg}`,
          });
        }
      }

      // Push tool results as a user turn and loop
      messages.push({ role: 'user', content: toolResults });

      // Safety valve: if stop_reason was end_turn with no tool_uses we'd
      // have already broken out. Otherwise continue until MAX iters.
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[nora/turn] anthropic call failed:', err);
    return NextResponse.json(
      { error: 'ai_call_failed', detail: msg },
      { status: 502 },
    );
  }

  if (!finalText) {
    finalText =
      "Something went wrong on my end. Let me open a ticket so someone " +
      'can follow up.';
  }

  // --- 12. INSERT assistant turn -------------------------------------------
  const assistantIndex = nextIndex + 1;
  const { error: assistantTurnErr } = await admin.from('nora_turns').insert({
    conversation_id: conversationId,
    turn_index: assistantIndex,
    role: 'assistant',
    content: finalText,
    tool_calls: toolCalls.length > 0 ? toolCalls : null,
    matched_pattern_id: matchedPattern?.id ?? null,
  });
  if (assistantTurnErr) {
    console.error('[nora/turn] assistant turn insert failed:', assistantTurnErr);
    // Non-fatal — we still return the text to the user. The audit row
    // is missing but the user experience is intact.
  }

  // --- 13. Return ----------------------------------------------------------
  return NextResponse.json({
    assistant_message: finalText,
    tool_calls: toolCalls,
    matched_pattern: matchedPattern
      ? {
          slug: matchedPattern.pattern_slug,
          title: matchedPattern.title,
        }
      : null,
    client_action: clientActionRequired,
    stop_reason: stopReason,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    },
    rate_limit: {
      turns_today: rlResult.turns_today,
      limit: rlResult.limit,
      resets_at: rlResult.resets_at,
    },
  });
}

// -----------------------------------------------------------------------------
// Helpers — composeSystemPrompt lives in lib/nora/compose-system-prompt.ts
// (extracted for Next.js 15 route-export rules + unit-testability)
// -----------------------------------------------------------------------------
