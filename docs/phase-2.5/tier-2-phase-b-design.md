# Phase 2.5 Item 3 Phase B — Tier 2 Tools Design

**Status:** Design locked, code pending.
**DB status:** `nora_tool_undo_tokens` live in production (verification chat, Phase A). Service-role grants confirmed (profiles.UPDATE, credit_transactions.INSERT, auth.users.SELECT).
**Scope:** Three Tier 2 tools + undo intent matcher, author surface only.

---

## Design commitments

Every decision here is locked unless verification chat objects before code ships. Going into Phase B with this level of spec was the missing discipline that made Phase A's mount-guard investigation cost four commits. Not repeating that mistake.

### 1. Three tools being built

| Tool | File | External API | Reverse tool_input |
|---|---|---|---|
| `change_email` | `lib/nora/tools/change-email.ts` | `admin.auth.admin.updateUserById` | `{ new_email: <old_email> }` |
| `adjust_credits_small` | `lib/nora/tools/adjust-credits-small.ts` | None (DB-only) | `{ delta: -<original_delta> }` |
| `pause_subscription` | `lib/nora/tools/pause-subscription.ts` | `stripe.subscriptions.update({ pause_collection: ... })` | `{ resume: true }` |

All three are Tier 2. No resume_subscription as a separate tool — `pause_subscription({ resume: true })` is the reverse path. One tool, one reverse shape. Simpler registry. Simpler mental model.

### 2. Tool registry additions

**`lib/nora/types.ts`** — no change. `NoraToolDefinition.tier: 1 | 2 | 3` already supports Tier 2.

**`lib/nora/tools/index.ts`** — add three imports + push onto `NORA_TOOLS`. Tier 1 and Tier 2 share the same registry; the `tier` field on each definition is what distinguishes them. `buildAnthropicToolsSpec()` continues to return all tools — Tier 2 tools ARE exposed to Claude as callable. The Tier 2 distinction is semantic (surface gating + undo token emission), not a registry filter.

**`lib/nora/tool-names.ts`** — add a new `NORA_TIER_2_TOOL_NAMES` constant alongside the existing Tier 1. Export both. `nora_known_issues.auto_fix_tool` can reference either tier's names going forward.

```ts
export const NORA_TIER_2_TOOL_NAMES = [
  'change_email',
  'adjust_credits_small',
  'pause_subscription',
] as const;

export type NoraTierTwoToolName = typeof NORA_TIER_2_TOOL_NAMES[number];
export type NoraToolName = NoraTierOneToolName | NoraTierTwoToolName;
```

### 3. Surface gate

Every Tier 2 tool's handler starts with the exact same check:

```ts
if (ctx.member.surface !== 'author') {
  return {
    ok: false,
    failure_reason: 'tier_2_not_available_on_surface',
    message_for_user:
      "This action isn't available from the {surface} surface — it " +
      'lives on the author dashboard.',
  };
}
```

Extracted to a shared helper `requireAuthorSurface(ctx)` in `lib/nora/tools/_tier2-helpers.ts` so the check is identical across all three tools and can't drift.

### 4. Undo token emission — the atomicity contract

Two distinct shapes:

**DB-only tool (`adjust_credits_small`):** forward action + undo-token INSERT in a single transaction. Since Supabase JS doesn't expose multi-statement transactions directly, use `admin.rpc('nora_adjust_credits_and_record_undo', {...})` — or if verification chat hasn't created that RPC, fall back to: (a) INSERT credit_transactions + UPDATE profiles in a single row-level atomic operation, (b) INSERT undo token immediately after. If (b) fails, log a `[nora:undo-token-insert-failed]` critical error but DO NOT attempt to reverse (a). The user keeps their credits; they just lose the undo window. Symmetry with external-API tools — same failure-mode semantics.

**Actually — reviewing the brief again, verification chat said explicitly: "adjust_credits_small is DB-only: wrap forward action + undo-token INSERT in a single transaction."** The only way to get a real transaction across Supabase JS operations is via an RPC. If the RPC doesn't exist yet, I need to either:
- **Option 1**: Ask verification chat to add a `nora_adjust_credits_and_record_undo(user_id, delta, reason, conversation_id, forward_turn_id, reverse_payload, expires_at) RETURNS nora_tool_undo_tokens` RPC as a Phase B.5 migration.
- **Option 2**: Ship the two-step sequence (UPDATE profiles + INSERT credit_transactions + INSERT undo token) sequentially with the same failure semantics as external-API tools. Document that "true atomicity" for adjust_credits_small is downgraded to "best-effort atomicity with visible audit trail".

**Recommendation: Option 1.** The brief is explicit that this should be transactional. A one-function RPC costs a migration round-trip but gives genuine atomicity. Verification chat has been fast on schema work — this is a single SQL function.

**External-API tools (`change_email`, `pause_subscription`):** external action first, undo-token INSERT second. If the token INSERT fails, log and swallow — the external action succeeded, the user sees the forward effect, they just lose undo. Per verification chat's brief.

### 5. Undo intent matcher — placement + false-positive defence

**Placement in turn route:** between step 5 (user turn INSERT) and step 6 (buildNoraContext). Specifically, after the user turn is persisted but before any Claude work happens. If an undo intent is detected, the matcher owns the entire turn:
- Look up the most recent active token
- If found: invoke the reverse tool, INSERT assistant turn with the reverse's `message_for_user`, UPDATE the token with consumed_at/consumed_by_turn_id, return the response
- If not found: INSERT assistant turn with "nothing to undo" friendly message, return
- In both cases: skip Claude, skip matchKnownIssue, skip the tool-use loop

**Pattern file:** `lib/nora/undo-intent-matcher.ts`. Exports `matchUndoIntent(userMessage: string): boolean`.

**Patterns (the hard part — false-positive defence):**

```ts
const UNDO_PATTERNS: RegExp[] = [
  // Full-message exact matches (the strongest signal)
  /^\s*undo\s*\.?\s*$/i,
  /^\s*revert\s*\.?\s*$/i,
  /^\s*cancel that\s*\.?\s*$/i,
  /^\s*nevermind\s*\.?\s*$/i,
  /^\s*never mind\s*\.?\s*$/i,

  // Short imperatives with clear referent
  /^\s*undo (that|the last|it)\s*\.?\s*$/i,
  /^\s*revert (that|the last|it)\s*\.?\s*$/i,
  /^\s*cancel (that|the last|it)\s*\.?\s*$/i,
  /^\s*take (that|the last|it) back\s*\.?\s*$/i,
  /^\s*(ignore|forget) (that|the last|it)\s*\.?\s*$/i,
];
```

**Critical: all patterns are anchored with `^` and `$`.** This is what defends against "I want to undo my last book cover design" — that message doesn't start with "undo" at the full-message level; it contains "undo" as a verb inside a longer sentence. Word-boundary-in-the-middle matching would be a false positive; full-message anchor matching is not.

The verification chat's brief explicitly flagged the "I want to undo my last book cover" case. Testing this as a negative case in the unit suite.

### 6. Token lookup query

```sql
SELECT id, forward_turn_id, tool_name, forward_summary, reverse_payload, expires_at
FROM nora_tool_undo_tokens
WHERE user_id = $1
  AND consumed_at IS NULL
  AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1;
```

Uses `idx_nora_undo_active` partial index. O(log n) lookup regardless of table size.

### 7. Reverse dispatch

The matched token's `reverse_payload` has shape `{ tool_name, tool_input }`. Dispatch via:

```ts
const reverseTool = findTool(token.reverse_payload.tool_name);
if (!reverseTool) {
  // Should never happen — reverse_payload.tool_name is controlled by us
  // at forward-action time. If this fires, it's a schema-drift bug.
  console.error('[nora:undo-reverse-tool-not-found]', { token_id: token.id, tool_name: token.reverse_payload.tool_name });
  // Fall through to "nothing to undo" user-facing
}
const reverseResult = await reverseTool.handler(token.reverse_payload.tool_input, toolCtx);
```

The reverse call produces its own `NoraToolResult`. Its `message_for_user` is what the assistant turn renders. We do NOT emit a NEW undo token from this reverse call — reversing an undo would be user-hostile. Each forward tool detects whether it's being called as a reverse-of-a-reverse by checking `input.is_reverse === true` which the matcher sets before dispatch:

```ts
const reverseResult = await reverseTool.handler(
  { ...token.reverse_payload.tool_input, is_reverse: true },
  toolCtx,
);
```

When a tool handler sees `input.is_reverse === true`, it skips the undo-token INSERT step. Forward logic runs, reverse logic runs, but no NEW token is created.

### 8. Token consumption UPDATE

After the reverse action succeeds:

```sql
UPDATE nora_tool_undo_tokens
SET consumed_at = now(),
    consumed_by_turn_id = $2
WHERE id = $1;
```

Tied to a specific turn row (the assistant turn created for the undo response). The constraint `(consumed_at, consumed_by_turn_id) must pair-or-neither` is satisfied by this single UPDATE.

If the reverse action itself fails (e.g., Stripe returns an error on the resume call), the token is NOT consumed. The original undo window remains open — the user can retry. Log the failure and return an error message.

### 9. Tool_result content format

Every Tier 2 forward tool's `message_for_user` includes the undo affordance as plain-text at the end:

```
"I've paused your subscription — billing is stopped until you resume. You have 60 minutes to undo this: just say undo and I'll reverse it."
```

Not a button. Not a UI control. Plain-text sentence. No Phase 2.6 UI scope creep into Phase B.

### 10. Rate limit for adjust_credits_small

Query for the 24h check (no new schema, per brief):

```sql
SELECT COUNT(*)::int AS count
FROM nora_turns t
INNER JOIN nora_conversations c ON c.id = t.conversation_id
WHERE c.user_id = $1
  AND t.role = 'tool_call'
  AND t.content->>'tool_name' = 'adjust_credits_small'
  AND t.created_at > (now() - interval '24 hours');
```

If count >= 1, reject with friendly message. Note: this joins through `nora_conversations` because `nora_turns` doesn't have user_id directly. The `idx_nora_turns_conversation_index` index on `nora_turns(conversation_id, turn_index)` keeps this performant.

Considered alternative: dedicated rate-limit RPC analogous to `nora_consume_turn` for per-tool rate limits. Rejected for Phase B — query is simple, no new schema, works now. If we add more rate-limited Tier 2 tools later, refactor into an RPC.

### 11. The RPC I need verification chat to add

**`nora_adjust_credits_and_record_undo`** (per section 4 above). Single Postgres function that runs in an implicit transaction:

```sql
CREATE OR REPLACE FUNCTION nora_adjust_credits_and_record_undo(
  p_user_id        UUID,
  p_delta          INTEGER,
  p_reason         TEXT,
  p_conversation_id UUID,
  p_forward_turn_id UUID,
  p_reverse_payload JSONB,
  p_expires_at     TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance INTEGER;
  v_undo_token_id UUID;
BEGIN
  -- Forward action: adjust balance
  UPDATE profiles
  SET credits_balance = credits_balance + p_delta
  WHERE id = p_user_id
  RETURNING credits_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  -- Audit row
  INSERT INTO credit_transactions (user_id, amount, reason, source)
  VALUES (p_user_id, p_delta, p_reason, 'nora_tool_adjust_credits_small');

  -- Undo token
  INSERT INTO nora_tool_undo_tokens (
    user_id, conversation_id, forward_turn_id, surface,
    tool_name, forward_summary, reverse_payload, expires_at
  ) VALUES (
    p_user_id, p_conversation_id, p_forward_turn_id, 'author',
    'adjust_credits_small',
    format('Adjusted credits by %s (%s)', p_delta, p_reason),
    p_reverse_payload,
    p_expires_at
  )
  RETURNING id INTO v_undo_token_id;

  RETURN jsonb_build_object(
    'new_balance', v_new_balance,
    'undo_token_id', v_undo_token_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION nora_adjust_credits_and_record_undo TO service_role;
```

If verification chat would rather downgrade to best-effort atomicity, I'll ship Option 2 and note the tradeoff in the tool's docblock. Flagging this as the one open decision.

### 12. What's NOT in Phase B

- **Cleanup cron** — per brief, deliberately skipped. Partial index keeps queries cheap.
- **Undo UI button** — per brief, Phase 2.6 scope.
- **Resume via distinct tool** — collapsed into `pause_subscription({ resume: true })`.
- **Tier 3 tools** — separate phase. Different architecture (admin approval queue, not direct execution).
- **diagnostic_sql / query_user_data** — Commit 7 known-issue matcher note called this out explicitly; still Phase 2.6+ scope.

---

## Implementation sequence

1. **Ask verification chat**: add the `nora_adjust_credits_and_record_undo` RPC OR confirm Option 2 acceptable.
2. **Once answer received**: write three tool files, one helper file (`_tier2-helpers.ts`), one intent matcher file.
3. **Wire into turn route**: intent matcher hook between steps 5 and 6.
4. **Extend tool-names + registry**.
5. **Tests**: per-tool happy path, rate-limit reject, surface gate, intent matcher including false-positive guard, token-consume happy path, expired-token rejection, no-token friendly response.
6. **Typecheck + test + commit + push**.
7. **Verification chat end-to-end probe** on preview deploy.

---

## Test plan

Following verification chat's list in the brief + my additions:

| # | Test | File |
|---|---|---|
| 1 | change_email happy path | `__tests__/nora-tier2.test.ts` |
| 2 | change_email rejects non-author surface | same |
| 3 | adjust_credits_small happy path | same |
| 4 | adjust_credits_small rate-limit reject (2nd call within 24h) | same |
| 5 | adjust_credits_small rejects delta > 1000 | same |
| 6 | adjust_credits_small rejects delta < -1000 | same |
| 7 | pause_subscription happy path (mocked Stripe) | same |
| 8 | pause_subscription resume (reverse) mocked Stripe | same |
| 9 | undo intent matcher: all positive patterns match | `__tests__/nora-undo-intent.test.ts` |
| 10 | undo intent matcher: false positives REJECTED | same |
| 11 | Token `is_reverse` flag suppresses undo-token INSERT | `__tests__/nora-tier2.test.ts` |
| 12 | Reverse tool_input shape matches forward's reverse_payload | same |

False-positive cases from (10):
- "I want to undo my last book cover design"
- "cancel that order please"
- "undo my subscription" (this is ambiguous — user likely means "I want to cancel my subscription" which should NOT fire undo intent)
- "never mind the docs I sent you yesterday"
- "revert to the previous version of my manuscript"

The `^...$` anchors handle all of these.

## Open decision for verification chat

**Only one:** confirm either (a) add the `nora_adjust_credits_and_record_undo` RPC for true atomicity, or (b) OK to ship adjust_credits_small as best-effort three-step sequence with explicit docblock about the tradeoff.

Everything else is locked.
