/**
 * Phase 2.5 Item 3 Commit 12 — nora_turns row builders.
 *
 * Extracted from the /turn route for Next.js 15 route-export rules AND
 * to make the row-shaping logic unit-testable without mocking Supabase.
 *
 * Prod schema carves nora_turns.role into 5 values:
 *   'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system_note'
 *
 * This is richer than the brief's original design which packed
 * tool_calls into a JSONB column on the assistant row. That column
 * doesn't exist in prod. The correct shape is:
 *
 *   turn_index=N     role='assistant'     content=<claude's text>,
 *                                         model_used, token counts,
 *                                         matched_pattern_id (first iter)
 *   turn_index=N+1   role='tool_call'     tool_name, tool_input
 *   turn_index=N+2   role='tool_result'   tool_name, tool_output
 *   turn_index=N+3   role='tool_call'     (next tool if multi-tool iter)
 *   ...
 *
 * Single-tool-per-iteration is by far the common case. Multi-tool in one
 * Claude response is rare but must persist cleanly as separate pairs.
 */

/**
 * Tool result envelope as returned by Nora tool handlers.
 * Mirrors NoraToolResult shape but with is_error tracked separately so
 * the persisted row has it at the top level of tool_output JSONB.
 */
export interface ToolResultEnvelope {
  ok: boolean;
  message_for_user?: string;
  data?: unknown;
  failure_reason?: string;
  action?: string;
  [key: string]: unknown;
}

/**
 * Common fields on every nora_turns row (except system_note which isn't
 * used in Commit 12).
 */
interface TurnRowBase {
  conversation_id: string;
  turn_index: number;
}

export interface AssistantTurnRow extends TurnRowBase {
  role: 'assistant';
  content: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  matched_pattern_id: string | null;
}

export interface ToolCallTurnRow extends TurnRowBase {
  role: 'tool_call';
  content: null;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolResultTurnRow extends TurnRowBase {
  role: 'tool_result';
  content: null;
  tool_name: string;
  tool_output: Record<string, unknown>;
}

/**
 * Shape the assistant row for one iteration of the Claude tool-use loop.
 *
 * matched_pattern_id policy: only populated on the FIRST iteration of
 * the loop. Subsequent iterations are Claude's continued reasoning after
 * tool results arrive; they don't belong to a fresh pattern match. If
 * we populated it on every iteration we'd over-count pattern matches
 * in the admin dashboard's resolution_success_rate calculation.
 */
export function buildAssistantTurnRow(args: {
  conversation_id: string;
  turn_index: number;
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  isFirstIteration: boolean;
  matchedPatternId: string | null;
}): AssistantTurnRow {
  return {
    conversation_id: args.conversation_id,
    turn_index: args.turn_index,
    role: 'assistant',
    content: args.content,
    model_used: args.model,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    matched_pattern_id: args.isFirstIteration ? args.matchedPatternId : null,
  };
}

/**
 * Shape a tool_call row. One per tool_use block in Claude's response.
 */
export function buildToolCallRow(args: {
  conversation_id: string;
  turn_index: number;
  toolName: string;
  toolInput: Record<string, unknown>;
}): ToolCallTurnRow {
  return {
    conversation_id: args.conversation_id,
    turn_index: args.turn_index,
    role: 'tool_call',
    content: null,
    tool_name: args.toolName,
    tool_input: args.toolInput,
  };
}

/**
 * Shape a tool_result row. One per executed tool, paired immediately
 * after its tool_call row.
 *
 * tool_output shape: { is_error, ...toolResult }. The is_error boolean
 * is flattened to the top level so admin UI queries against tool_output
 * don't have to reach into a nested shape. We also keep the full
 * toolResult so auditors can see message_for_user, data, and
 * failure_reason exactly as Nora saw them.
 */
export function buildToolResultRow(args: {
  conversation_id: string;
  turn_index: number;
  toolName: string;
  toolResult: ToolResultEnvelope;
}): ToolResultTurnRow {
  return {
    conversation_id: args.conversation_id,
    turn_index: args.turn_index,
    role: 'tool_result',
    content: null,
    tool_name: args.toolName,
    tool_output: {
      is_error: args.toolResult.ok === false,
      ...args.toolResult,
    },
  };
}

/**
 * Compute the full sequence of turn_index values that will be consumed
 * by one iteration of the tool-use loop, given the assistant row count
 * (always 1 per iteration) and the number of tool calls in that
 * iteration's response.
 *
 * Order of indices: assistant, then each tool as (call, result) pair.
 *
 *   1 assistant + 0 tools =>  [N]
 *   1 assistant + 1 tool  =>  [N, N+1, N+2]                 (a, call, result)
 *   1 assistant + 2 tools =>  [N, N+1, N+2, N+3, N+4]       (a, c1, r1, c2, r2)
 *
 * Pure function — returned to callers so they can increment their
 * nextTurnIndex counter correctly between DB inserts.
 */
export function computeTurnIndicesForIteration(args: {
  startIndex: number;
  numAssistantRows: number;
  numToolCalls: number;
}): number[] {
  const indices: number[] = [];
  let i = args.startIndex;
  for (let a = 0; a < args.numAssistantRows; a++) {
    indices.push(i);
    i += 1;
  }
  for (let t = 0; t < args.numToolCalls; t++) {
    indices.push(i); // tool_call
    i += 1;
    indices.push(i); // tool_result
    i += 1;
  }
  return indices;
}
