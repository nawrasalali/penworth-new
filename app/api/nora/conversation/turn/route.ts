import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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
import {
  buildAssistantTurnRow,
  buildToolCallRow,
  buildToolResultRow,
  type ToolResultEnvelope,
} from '@/lib/nora/turn-row-builders';
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

  const admin = createServiceClient();

  // --- 3. Load conversation + ownership check ------------------------------
  // Load the full stat columns we'll UPDATE at end of request (turn_count,
  // token_*_total, cost_usd) to read-modify-write them in-process. Also
  // select ended_at (NOT closed_at — the column was renamed in prod schema
  // but the old Commit 6 code gated on closed_at, silently making the
  // 410 gate never fire).
  const { data: conversation, error: convErr } = await admin
    .from('nora_conversations')
    .select(
      'id, user_id, surface, user_role, language, ended_at, resolution, turn_count, token_input_total, token_output_total, cost_usd',
    )
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
  if (conversation.ended_at) {
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

  // Row-persistence counters. nextRowIndex starts immediately after the
  // user turn we just inserted at `nextIndex`. Assistant rows, tool_call
  // rows and tool_result rows all consume turn_index values sequentially.
  let nextRowIndex = nextIndex + 1;
  let assistantRowsInserted = 0;
  let toolRowsInserted = 0; // count of (tool_call + tool_result) rows combined

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

      const textBlocks = response.content.filter(
        (c) => c.type === 'text',
      ) as Anthropic.Messages.TextBlock[];
      const toolUses = response.content.filter(
        (c) => c.type === 'tool_use',
      ) as Anthropic.Messages.ToolUseBlock[];

      // Assemble this iteration's text content. If Claude mixes text +
      // tool_use, the LAST iteration's text becomes user-visible finalText
      // (the model echoes/recaps in its final turn after tool results).
      const iterationText = textBlocks.map((t) => t.text).join('\n');
      if (iterationText) {
        finalText = iterationText;
      }

      // Persist assistant row for this iteration. Write every iteration
      // unconditionally — even when iterationText is empty (pure tool_use
      // response), the row is valuable audit showing "Claude chose to
      // call tools without speaking on this iteration". model_used +
      // token counts always present. matched_pattern_id only on first
      // iteration to avoid over-counting in resolution_success_rate.
      const assistantRow = buildAssistantTurnRow({
        conversation_id: conversationId,
        turn_index: nextRowIndex,
        content: iterationText,
        model: MODEL_IDS.haiku,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        isFirstIteration: iter === 0,
        matchedPatternId: matchedPattern?.id ?? null,
      });
      nextRowIndex += 1;
      assistantRowsInserted += 1;

      const { error: assistErr } = await admin
        .from('nora_turns')
        .insert(assistantRow);
      if (assistErr) {
        console.error(
          `[nora/turn] assistant row insert failed (iter ${iter}):`,
          assistErr,
        );
        // Non-fatal — user still gets their response. Audit row missing
        // for this iteration only.
      }

      // Record Claude's assistant turn verbatim for Claude-API context.
      // This is separate from the DB persistence — Claude needs the full
      // content array (text blocks + tool_use blocks) for its own state;
      // the DB gets the split-row shape.
      messages.push({ role: 'assistant', content: response.content });

      if (!toolUses.length) {
        // No tool calls this iteration — Nora is done.
        break;
      }

      // Dispatch each tool_use. For every tool_use block: persist a
      // tool_call row, execute the tool, persist a tool_result row,
      // and accumulate the API-facing tool_result payload for the next
      // Claude iteration.
      const apiToolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const use of toolUses) {
        const input = use.input as Record<string, unknown>;

        // Persist tool_call row
        const callRow = buildToolCallRow({
          conversation_id: conversationId,
          turn_index: nextRowIndex,
          toolName: use.name,
          toolInput: input,
        });
        nextRowIndex += 1;
        toolRowsInserted += 1;
        const { error: callErr } = await admin
          .from('nora_turns')
          .insert(callRow);
        if (callErr) {
          console.error('[nora/turn] tool_call row insert failed:', callErr);
        }

        // Execute the tool and produce a persisted envelope + API content
        const tool = findTool(use.name);
        let resultEnvelope: ToolResultEnvelope;
        let apiContent: string;
        let isError: boolean;

        if (!tool) {
          // Unknown tool — synthesise an error envelope so Claude can
          // apologise in its next turn instead of crashing the loop.
          resultEnvelope = {
            ok: false,
            failure_reason: `Unknown tool: ${use.name}`,
          };
          apiContent = `Unknown tool: ${use.name}`;
          isError = true;
          toolCalls.push({
            name: use.name,
            input,
            result: { error: 'unknown_tool' },
          });
        } else {
          try {
            const result = await tool.handler(input, toolCtx);
            if (result.action === 'client_refresh_required') {
              clientActionRequired = 'client_refresh_required';
            }
            toolCalls.push({
              name: use.name,
              input,
              result,
            });
            resultEnvelope = {
              ok: result.ok,
              message_for_user: result.message_for_user,
              data: result.data,
              failure_reason: result.failure_reason,
              action: result.action,
            };
            apiContent = JSON.stringify({
              ok: result.ok,
              message_for_user: result.message_for_user,
              data: result.data,
              failure_reason: result.failure_reason,
            });
            isError = !result.ok;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[nora/turn] tool ${use.name} handler threw:`,
              err,
            );
            resultEnvelope = {
              ok: false,
              failure_reason: 'handler_exception',
              data: { message: msg },
            };
            apiContent = `Tool handler error: ${msg}`;
            isError = true;
            toolCalls.push({
              name: use.name,
              input,
              result: { error: 'handler_exception', message: msg },
            });
          }
        }

        // Persist tool_result row
        const resultRow = buildToolResultRow({
          conversation_id: conversationId,
          turn_index: nextRowIndex,
          toolName: use.name,
          toolResult: resultEnvelope,
        });
        nextRowIndex += 1;
        toolRowsInserted += 1;
        const { error: resultErr } = await admin
          .from('nora_turns')
          .insert(resultRow);
        if (resultErr) {
          console.error('[nora/turn] tool_result row insert failed:', resultErr);
        }

        // Push to Claude-API context for next iteration
        apiToolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: isError,
          content: apiContent,
        });
      }

      // Push tool results as a user turn and loop
      messages.push({ role: 'user', content: apiToolResults });

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

  // --- 12. End-of-request conversation stats UPDATE ------------------------
  // Persist accumulated state on nora_conversations: last_turn_at,
  // updated_at (no DB trigger auto-bumps it — app-layer one-liner per
  // verification chat), turn_count, token totals, cost_usd, and
  // conditional resolution transition.
  //
  // Resolution state machine in Commit 12: only the 'open' →
  // 'escalated_to_ticket' transition is automated. Fires when the
  // open_support_ticket tool returned ok=true this request. Other
  // transitions ('resolved_by_nora', 'resolved_by_tool_action',
  // 'abandoned') need user feedback signals or a cleanup cron — both
  // deferred to a later phase.
  //
  // Concurrency note: read-modify-write on turn_count/tokens/cost is
  // safe under the widget's UX invariant (input disabled during
  // in-flight /turn request, so no two /turn calls for the same
  // conversation can race). Multi-tab could theoretically double-fire
  // — the resulting overcount is not data corruption. Atomic increment
  // RPC is parked as future hardening.
  //
  // Claude Haiku 4.5 pricing: $1/M input tokens, $5/M output tokens.
  const requestCostUsd =
    totalInputTokens * 0.000001 + totalOutputTokens * 0.000005;
  const turnsInserted = 1 + assistantRowsInserted + toolRowsInserted;
  const didEscalate = toolCalls.some((tc) => {
    if (tc.name !== 'open_support_ticket') return false;
    const r = tc.result as { ok?: boolean } | null | undefined;
    return r?.ok === true;
  });
  const nowIso = new Date().toISOString();

  const conversationUpdate: Record<string, unknown> = {
    last_turn_at: nowIso,
    updated_at: nowIso,
    turn_count: (conversation.turn_count ?? 0) + turnsInserted,
    token_input_total: (conversation.token_input_total ?? 0) + totalInputTokens,
    token_output_total:
      (conversation.token_output_total ?? 0) + totalOutputTokens,
    cost_usd: Number(conversation.cost_usd ?? 0) + requestCostUsd,
  };
  if (didEscalate) {
    conversationUpdate.resolution = 'escalated_to_ticket';
    conversationUpdate.ended_at = nowIso;
  }

  const { error: convUpdateErr } = await admin
    .from('nora_conversations')
    .update(conversationUpdate)
    .eq('id', conversationId);
  if (convUpdateErr) {
    console.error(
      '[nora/turn] conversation stats UPDATE failed (non-fatal):',
      convUpdateErr,
    );
    // Non-fatal — the per-turn rows were persisted correctly; the
    // conversation row's aggregate stats lag by one turn. Admin UI
    // computing live stats via COUNT(*) / SUM() would still be accurate.
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
