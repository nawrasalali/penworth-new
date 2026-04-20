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
import { matchUndoIntent } from '@/lib/nora/undo-intent-matcher';
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
import type { NoraContext, NoraSurface, NoraToolContext } from '@/lib/nora/types';

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

  // --- 6.5. Undo intent matcher (Phase B) ---------------------------------
  // If the user's message is a full-message undo command ("undo" /
  // "revert that" / "cancel that" / etc.), skip Claude entirely and
  // dispatch the reverse payload on the most recent active undo token.
  // matchUndoIntent is conservative — anchored ^...$ patterns — so we
  // accept zero false positives in exchange for tolerating some false
  // negatives (a missed undo means Claude sees the message and can
  // still respond helpfully).
  if (matchUndoIntent(userMessage)) {
    const undoResponse = await runUndoFlow({
      admin,
      userId: user.id,
      conversationId,
      nextIndex,
      surface,
      userMessage,
      ctx,
    });
    return NextResponse.json(undoResponse);
  }

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

  // forward_turn_id is populated per-tool-call inside the dispatch loop,
  // immediately after inserting the tool_call row. See the `.select('id')`
  // on that insert below. Tier 2 tools (change_email, adjust_credits_small,
  // pause_subscription) read this to populate the FK on nora_tool_undo_tokens.
  // Tier 1 tools don't touch it. Initialised as empty string so any
  // misordered call — reading before it's set — produces a loud, localized
  // FK violation rather than a silent cascading bug.
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
    forward_turn_id: '',
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

        // Persist tool_call row. We now SELECT the returned id so Tier 2
        // tools can populate nora_tool_undo_tokens.forward_turn_id (FK to
        // nora_turns.id). Tier 1 tools ignore the field. If this insert
        // fails, we fall back to a zero UUID that downstream FK check on
        // the undo token INSERT will reject — the tool's undo emission
        // will log [undo-token-insert-failed] and continue. The forward
        // action still completes.
        const callRow = buildToolCallRow({
          conversation_id: conversationId,
          turn_index: nextRowIndex,
          toolName: use.name,
          toolInput: input,
        });
        nextRowIndex += 1;
        toolRowsInserted += 1;
        const { data: insertedCall, error: callErr } = await admin
          .from('nora_turns')
          .insert(callRow)
          .select('id')
          .maybeSingle<{ id: string }>();
        if (callErr) {
          console.error('[nora/turn] tool_call row insert failed:', callErr);
        }
        // Populate forward_turn_id for THIS tool invocation. If the insert
        // failed, leave it as empty string (or previous turn's id) so the
        // handler won't try to use a stale value. Tier 2 tools null-check.
        toolCtx.forward_turn_id = insertedCall?.id ?? '';

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

/**
 * runUndoFlow — Phase 2.5 Item 3 Phase B.
 *
 * Handles a user turn whose message matches the undo intent matcher.
 * Bypasses Claude entirely — this is a deterministic path driven by the
 * most recent active undo token. Steps:
 *
 *   1. Look up the most recent active token (consumed_at IS NULL,
 *      expires_at > now()). Uses idx_nora_undo_active partial index.
 *   2. If no token found: INSERT a friendly assistant turn, return.
 *   3. If token found: resolve reverse_payload → findTool(name).
 *   4. Insert a tool_call row for the reverse invocation so the FK
 *      target exists for adjust_credits_small's RPC (and to preserve
 *      the audit pattern of tool_call+tool_result+assistant).
 *   5. Invoke tool.handler with { ...reverse_tool_input, is_reverse: true }.
 *   6. If reverse succeeds: insert tool_result row, insert assistant row
 *      with the reverse's message_for_user, UPDATE token with
 *      consumed_at + consumed_by_turn_id=<assistant row id>.
 *   7. If reverse fails: insert tool_result row with error, insert
 *      assistant row with a user-visible apology, DO NOT consume the
 *      token (window stays open so user can retry).
 *
 * Returns the same envelope shape as the normal POST handler so the
 * widget renders the response identically.
 */
async function runUndoFlow(args: {
  admin: ReturnType<typeof createServiceClient>;
  userId: string;
  conversationId: string;
  nextIndex: number;
  surface: NoraSurface;
  userMessage: string;
  ctx: NoraContext;
}): Promise<{
  assistant_message: string;
  tool_calls: Array<{ name: string; input: Record<string, unknown>; result: unknown }>;
  matched_pattern: null;
  client_action: null;
  stop_reason: 'undo_flow';
  usage: { input_tokens: 0; output_tokens: 0 };
}> {
  const { admin, userId, conversationId, nextIndex, surface, ctx } = args;
  let nextRowIndex = nextIndex + 1;

  // 1. Look up active token.
  const { data: token, error: tokenErr } = await admin
    .from('nora_tool_undo_tokens')
    .select('id, tool_name, forward_summary, reverse_payload, expires_at')
    .eq('user_id', userId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenErr) {
    console.error('[nora/turn:undo-flow] token lookup error:', tokenErr);
    // Fall through to friendly message — user shouldn't see DB error.
  }

  // 2. No token → friendly "nothing to undo" response.
  if (!token) {
    const friendly =
      "There's nothing to undo right now — either the 60-minute undo " +
      'window expired on the last action, or there are no reversible ' +
      "actions in this conversation yet. If you meant something else, " +
      'just tell me what you need.';

    const assistRow = buildAssistantTurnRow({
      conversation_id: conversationId,
      turn_index: nextRowIndex,
      content: friendly,
      model: 'undo-matcher',
      inputTokens: 0,
      outputTokens: 0,
      isFirstIteration: true,
      matchedPatternId: null,
    });
    await admin.from('nora_turns').insert(assistRow);

    return {
      assistant_message: friendly,
      tool_calls: [],
      matched_pattern: null,
      client_action: null,
      stop_reason: 'undo_flow',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  // 3. Resolve reverse tool.
  const reversePayload = token.reverse_payload as {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
  };
  const reverseToolName = reversePayload?.tool_name;
  const reverseToolInput = reversePayload?.tool_input ?? {};

  if (!reverseToolName || typeof reverseToolName !== 'string') {
    console.error('[nora/turn:undo-flow] token has malformed reverse_payload', {
      token_id: token.id,
      reverse_payload: token.reverse_payload,
    });
    const msg =
      "I found the undo record but couldn't read the reversal details — " +
      "this is a bug on my side. Let me open a ticket.";
    const assistRow = buildAssistantTurnRow({
      conversation_id: conversationId,
      turn_index: nextRowIndex,
      content: msg,
      model: 'undo-matcher',
      inputTokens: 0,
      outputTokens: 0,
      isFirstIteration: true,
      matchedPatternId: null,
    });
    await admin.from('nora_turns').insert(assistRow);
    return {
      assistant_message: msg,
      tool_calls: [],
      matched_pattern: null,
      client_action: null,
      stop_reason: 'undo_flow',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const reverseTool = findTool(reverseToolName);
  if (!reverseTool) {
    console.error('[nora/turn:undo-flow] reverse tool not in registry', {
      token_id: token.id,
      tool_name: reverseToolName,
    });
    const msg =
      "I found the undo record but the reversal tool isn't available on " +
      "this version of the platform. Let me open a ticket.";
    const assistRow = buildAssistantTurnRow({
      conversation_id: conversationId,
      turn_index: nextRowIndex,
      content: msg,
      model: 'undo-matcher',
      inputTokens: 0,
      outputTokens: 0,
      isFirstIteration: true,
      matchedPatternId: null,
    });
    await admin.from('nora_turns').insert(assistRow);
    return {
      assistant_message: msg,
      tool_calls: [],
      matched_pattern: null,
      client_action: null,
      stop_reason: 'undo_flow',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  // 4. Insert tool_call row for the reverse. This row's id becomes
  //    ctx.forward_turn_id for the reverse invocation. Required because
  //    adjust_credits_small's RPC has a FK to nora_turns(id) from the new
  //    undo token it emits on the reverse — which adjust_credits_small then
  //    self-consumes (see its handler for the logic).
  const reverseInputWithFlag = { ...reverseToolInput, is_reverse: true };
  const callRow = buildToolCallRow({
    conversation_id: conversationId,
    turn_index: nextRowIndex,
    toolName: reverseToolName,
    toolInput: reverseInputWithFlag,
  });
  nextRowIndex += 1;
  const { data: insertedCall } = await admin
    .from('nora_turns')
    .insert(callRow)
    .select('id')
    .maybeSingle<{ id: string }>();
  const reverseCallTurnId = insertedCall?.id ?? '';

  // 5. Invoke the reverse handler.
  const toolCtx: NoraToolContext = {
    member: ctx,
    conversation_id: conversationId,
    matched_pattern: null,
    forward_turn_id: reverseCallTurnId,
  };

  let reverseResult;
  try {
    reverseResult = await reverseTool.handler(reverseInputWithFlag, toolCtx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[nora/turn:undo-flow] reverse handler threw', {
      token_id: token.id,
      tool_name: reverseToolName,
      error: msg,
    });
    reverseResult = {
      ok: false,
      failure_reason: `handler_threw: ${msg}`,
      message_for_user:
        "I hit an error trying to undo that action. Nothing else has " +
        'changed — your previous state is still in place. Let me open a ' +
        'ticket for this.',
    };
  }

  // 6a. Insert tool_result row regardless of success — audit trail.
  const resultRow = buildToolResultRow({
    conversation_id: conversationId,
    turn_index: nextRowIndex,
    toolName: reverseToolName,
    toolResult: reverseResult as ToolResultEnvelope,
  });
  nextRowIndex += 1;
  await admin.from('nora_turns').insert(resultRow);

  // 6b. Insert assistant turn with the reverse's user-facing message.
  const assistantText =
    reverseResult.message_for_user ??
    (reverseResult.ok
      ? "Done — the previous action has been reversed."
      : "I couldn't undo that. Your previous state is unchanged.");

  const assistRow = buildAssistantTurnRow({
    conversation_id: conversationId,
    turn_index: nextRowIndex,
    content: assistantText,
    model: 'undo-matcher',
    inputTokens: 0,
    outputTokens: 0,
    isFirstIteration: true,
    matchedPatternId: null,
  });
  const { data: insertedAssist } = await admin
    .from('nora_turns')
    .insert(assistRow)
    .select('id')
    .maybeSingle<{ id: string }>();

  // 7. Consume token only on success. Failed reverse leaves the window
  //    open so the user can retry.
  if (reverseResult.ok && insertedAssist?.id) {
    const { error: consumeErr } = await admin
      .from('nora_tool_undo_tokens')
      .update({
        consumed_at: new Date().toISOString(),
        consumed_by_turn_id: insertedAssist.id,
      })
      .eq('id', token.id);
    if (consumeErr) {
      console.error('[nora/turn:undo-flow] token consume UPDATE failed', {
        token_id: token.id,
        code: consumeErr.code,
        message: consumeErr.message,
      });
      // The reverse already happened. Leaving the token marked consumable
      // means a subsequent "undo" would reverse the reverse. Not catastrophic
      // but undesirable — logging loud for ops follow-up.
    }
  }

  return {
    assistant_message: assistantText,
    tool_calls: [
      {
        name: reverseToolName,
        input: reverseInputWithFlag,
        result: reverseResult,
      },
    ],
    matched_pattern: null,
    client_action: null,
    stop_reason: 'undo_flow',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

// Unused import suppression — `surface` param is destructured for API
// symmetry with /start even though runUndoFlow doesn't need it on the
// current flow. Keeping the shape stable for Phase 2.6 changes.
