/**
 * Undo intent matcher — Phase 2.5 Item 3 Phase B.
 *
 * Detects when a user message is a DIRECT undo request for the most
 * recent reversible Tier 2 action (within the 60-minute window).
 *
 * === THE FALSE-POSITIVE PROBLEM ===
 *
 * Naive substring matching on "undo" would trigger on perfectly
 * ordinary sentences that contain the word as a verb rather than an
 * imperative:
 *
 *   "I want to undo my last book cover design"
 *   "cancel that order please"
 *   "undo my subscription"          (user wants to CANCEL, not undo a
 *                                    recent action)
 *   "never mind the docs I sent you yesterday"
 *   "revert to the previous version of my manuscript"
 *
 * A false-positive undo match on any of these would fire a reverse
 * action on whatever Tier 2 tool ran most recently — catastrophic if
 * the user just did a credit adjustment and then mentioned the word
 * "undo" in passing.
 *
 * === THE SOLUTION: FULL-MESSAGE ANCHORS ===
 *
 * Every pattern is anchored with `^` and `$` (with forgiving
 * whitespace + trailing punctuation allowances). This means the
 * ENTIRE message must be an undo-style command — "undo" as a word
 * embedded in a longer sentence will never match.
 *
 * "undo" → matches (exactly "undo", optional punctuation).
 * "I want to undo my book cover" → does NOT match (extra words before
 *                                   and after).
 * "undo that" → matches (full-message imperative with clear referent).
 * "undo my subscription" → does NOT match ("my subscription" is a
 *                                           specific object, not a
 *                                           referent to the last action).
 *
 * === IMPORT CONTRACT ===
 *
 * matchUndoIntent(userMessage) returns a boolean. True means "this
 * message is an undo intent; the turn route should skip Claude and
 * run the undo flow directly." False means "proceed normally."
 *
 * Zero false negatives are tolerable — if we miss an undo intent,
 * Claude sees the message and can still respond helpfully ("want me
 * to reverse that?"). Zero false positives is critical — a spurious
 * undo would silently reverse a money-adjacent action.
 *
 * If in doubt, the function returns false. Conservative by design.
 */

const UNDO_PATTERNS: RegExp[] = [
  // Full-message exact matches — the strongest signal. Allows
  // trailing . ! ? and surrounding whitespace.
  /^\s*undo\s*[.!?]?\s*$/i,
  /^\s*revert\s*[.!?]?\s*$/i,
  /^\s*cancel that\s*[.!?]?\s*$/i,
  /^\s*nevermind\s*[.!?]?\s*$/i,
  /^\s*never mind\s*[.!?]?\s*$/i,

  // Short imperatives with a clear, generic referent.
  // "that / the last / it" are the only valid referents — "my X"
  // points at a specific object, not the last action.
  /^\s*undo (that|the last|it)\s*[.!?]?\s*$/i,
  /^\s*revert (that|the last|it)\s*[.!?]?\s*$/i,
  /^\s*cancel (that|the last|it)\s*[.!?]?\s*$/i,
  /^\s*take (that|the last|it) back\s*[.!?]?\s*$/i,
  /^\s*(ignore|forget) (that|the last|it)\s*[.!?]?\s*$/i,

  // Slightly more verbose forms users commonly type on mobile.
  /^\s*(please )?undo (that|the last|it)\s*[.!?]?\s*$/i,
  /^\s*(actually,?\s*)?(undo|revert|cancel) (that|the last|it)\s*[.!?]?\s*$/i,
];

/**
 * Returns true iff the user's message is a full-message undo command
 * (not merely a sentence containing the word "undo").
 */
export function matchUndoIntent(userMessage: string): boolean {
  if (typeof userMessage !== 'string') return false;
  // Defensive length check — an undo intent is a short imperative;
  // anything over 80 characters is not an undo command even if it
  // matches a pattern somehow. Cheap additional safety net.
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 80) return false;

  return UNDO_PATTERNS.some((pattern) => pattern.test(trimmed));
}
