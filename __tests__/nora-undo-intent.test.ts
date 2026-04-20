/**
 * Phase 2.5 Item 3 Phase B — undo intent matcher tests.
 *
 * Zero false positives is the load-bearing guarantee — a spurious undo
 * match would silently reverse a Tier 2 action (credit adjustment,
 * email change, subscription pause). These tests lock down the
 * anchor-based matching regime against the specific false-positive
 * cases the design doc flagged.
 */

import { describe, it, expect } from 'vitest';
import { matchUndoIntent } from '@/lib/nora/undo-intent-matcher';

describe('matchUndoIntent — positive patterns (TRUE)', () => {
  it('matches bare "undo"', () => {
    expect(matchUndoIntent('undo')).toBe(true);
  });

  it('matches bare "undo" with trailing period', () => {
    expect(matchUndoIntent('undo.')).toBe(true);
  });

  it('matches bare "undo" with exclamation', () => {
    expect(matchUndoIntent('undo!')).toBe(true);
  });

  it('matches case-insensitive "UNDO"', () => {
    expect(matchUndoIntent('UNDO')).toBe(true);
  });

  it('matches "undo that"', () => {
    expect(matchUndoIntent('undo that')).toBe(true);
  });

  it('matches "undo the last"', () => {
    expect(matchUndoIntent('undo the last')).toBe(true);
  });

  it('matches "undo it"', () => {
    expect(matchUndoIntent('undo it')).toBe(true);
  });

  it('matches "revert"', () => {
    expect(matchUndoIntent('revert')).toBe(true);
  });

  it('matches "revert that"', () => {
    expect(matchUndoIntent('revert that')).toBe(true);
  });

  it('matches "cancel that"', () => {
    expect(matchUndoIntent('cancel that')).toBe(true);
  });

  it('matches "cancel it"', () => {
    expect(matchUndoIntent('cancel it')).toBe(true);
  });

  it('matches "nevermind"', () => {
    expect(matchUndoIntent('nevermind')).toBe(true);
  });

  it('matches "never mind"', () => {
    expect(matchUndoIntent('never mind')).toBe(true);
  });

  it('matches "take that back"', () => {
    expect(matchUndoIntent('take that back')).toBe(true);
  });

  it('matches "take it back"', () => {
    expect(matchUndoIntent('take it back')).toBe(true);
  });

  it('matches "ignore that"', () => {
    expect(matchUndoIntent('ignore that')).toBe(true);
  });

  it('matches "forget it"', () => {
    expect(matchUndoIntent('forget it')).toBe(true);
  });

  it('matches with leading whitespace', () => {
    expect(matchUndoIntent('  undo  ')).toBe(true);
  });

  it('matches "please undo that"', () => {
    expect(matchUndoIntent('please undo that')).toBe(true);
  });

  it('matches "actually, undo that"', () => {
    expect(matchUndoIntent('actually, undo that')).toBe(true);
  });

  it('matches "actually undo it"', () => {
    expect(matchUndoIntent('actually undo it')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Critical false-positive defence cases from the design doc.
// Each of these contains an undo-related verb but is NOT an undo command;
// a false positive here would silently reverse a money-adjacent action.
// -----------------------------------------------------------------------------

describe('matchUndoIntent — false-positive defence (FALSE)', () => {
  it('rejects "I want to undo my last book cover design"', () => {
    // The 5 canonical cases named in the design doc — all contain undo
    // vocabulary but are longer sentences referring to specific objects.
    expect(matchUndoIntent('I want to undo my last book cover design')).toBe(false);
  });

  it('rejects "cancel that order please"', () => {
    expect(matchUndoIntent('cancel that order please')).toBe(false);
  });

  it('rejects "undo my subscription"', () => {
    // "my subscription" is a specific noun — not a generic referent to
    // the last action. User likely means "cancel my subscription" which
    // should go through the normal tool flow, not the undo path.
    expect(matchUndoIntent('undo my subscription')).toBe(false);
  });

  it('rejects "never mind the docs I sent you yesterday"', () => {
    expect(matchUndoIntent('never mind the docs I sent you yesterday')).toBe(false);
  });

  it('rejects "revert to the previous version of my manuscript"', () => {
    expect(matchUndoIntent('revert to the previous version of my manuscript')).toBe(false);
  });

  it('rejects "undo my email change"', () => {
    // Even though this is close to a valid undo intent, the presence of
    // "my email change" as an object makes it ambiguous. The user should
    // just say "undo" — we bias strongly toward false negatives over
    // false positives.
    expect(matchUndoIntent('undo my email change')).toBe(false);
  });

  it('rejects "can you undo that for me"', () => {
    // Could be interpreted as an undo intent but contains extra words
    // that aren't in our pattern set. Claude will see it and offer to
    // reverse — the safety tradeoff is acceptable.
    expect(matchUndoIntent('can you undo that for me')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(matchUndoIntent('')).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    expect(matchUndoIntent('   ')).toBe(false);
  });

  it('rejects non-string input safely', () => {
    // @ts-expect-error intentionally testing defensive behaviour
    expect(matchUndoIntent(null)).toBe(false);
    // @ts-expect-error
    expect(matchUndoIntent(undefined)).toBe(false);
    // @ts-expect-error
    expect(matchUndoIntent(42)).toBe(false);
  });

  it('rejects messages over 80 characters even if they contain undo patterns', () => {
    // Length guard — an undo is a short imperative; a paragraph-long
    // message is never an undo command even if it technically matches
    // one of the patterns somehow.
    const long = 'undo ' + 'x'.repeat(100);
    expect(matchUndoIntent(long)).toBe(false);
  });

  it('rejects "I undid that earlier"', () => {
    // Past-tense "undid" is a statement, not an imperative.
    expect(matchUndoIntent('I undid that earlier')).toBe(false);
  });

  it('rejects sentences that end in undo-related words', () => {
    // Substring matching would catch these; anchored matching does not.
    expect(matchUndoIntent('I said undo')).toBe(false);
    expect(matchUndoIntent('did you undo')).toBe(false);
  });

  it('rejects "revert my last book" (specific object)', () => {
    expect(matchUndoIntent('revert my last book')).toBe(false);
  });
});
