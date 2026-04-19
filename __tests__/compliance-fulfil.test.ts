/**
 * Unit tests for lib/compliance-fulfil.ts — pure logic.
 *
 * Does NOT exercise fulfilExportRequest() itself (that requires a real
 * Supabase + Storage + auth admin setup, which belongs in a separate
 * integration harness). Covers the pieces that are deterministic and
 * testable in isolation:
 *
 *   1. applyRedaction() — the core data-protection function. If this
 *      regresses, encrypted credentials could leak in an export file
 *      that gets emailed to the user. High-consequence surface.
 *   2. USER_SCOPED_TABLES registry — no duplicate table names, every
 *      userColumn value is in the allowed set.
 *   3. REDACTED_COLUMNS_BY_TABLE — every table name mentioned exists
 *      in the registry (cheap check; catches typos where someone adds
 *      redaction rules for a table that was retired).
 */

import { describe, it, expect } from 'vitest';
import {
  applyRedaction,
  USER_SCOPED_TABLES,
  REDACTED_COLUMNS_BY_TABLE,
} from '@/lib/compliance-fulfil';

describe('lib/compliance-fulfil — applyRedaction', () => {
  it('returns the same array reference when no redaction rules apply', () => {
    // Tables without redaction rules should get a zero-cost pass-through.
    // Reference equality is the marker — we're asserting no unnecessary
    // array allocation happens in the common case.
    const rows = [{ id: '1', content: 'hello' }];
    const result = applyRedaction(rows, 'projects');
    expect(result).toBe(rows);
  });

  it('redacts only the configured columns on publishing_credentials', () => {
    const rows = [
      {
        id: 'abc',
        user_id: 'user-1',
        platform: 'amazon_kdp',
        username: 'author@example.com',
        encrypted_password: 'pbkdf2$iter=100000$salt$hash-bytes-here',
        encrypted_api_key: 'aes-256-gcm-ciphertext',
        encrypted_secret: 'more-ciphertext',
        encrypted_token: 'refresh-token-ciphertext',
        created_at: '2026-04-19T00:00:00Z',
      },
    ];
    const result = applyRedaction(rows, 'publishing_credentials');
    expect(result).toHaveLength(1);
    const r = result[0];

    // Sensitive columns redacted
    expect(r.encrypted_password).toBe('[REDACTED]');
    expect(r.encrypted_api_key).toBe('[REDACTED]');
    expect(r.encrypted_secret).toBe('[REDACTED]');
    expect(r.encrypted_token).toBe('[REDACTED]');

    // Non-sensitive columns preserved
    expect(r.id).toBe('abc');
    expect(r.user_id).toBe('user-1');
    expect(r.platform).toBe('amazon_kdp');
    expect(r.username).toBe('author@example.com');
    expect(r.created_at).toBe('2026-04-19T00:00:00Z');
  });

  it('does not mutate the input rows', () => {
    // Redaction must be non-destructive — the input array and its
    // member objects must be untouched after the call.
    const originalRow = {
      id: 'abc',
      encrypted_password: 'secret-value',
      other: 'keep',
    };
    const rows = [originalRow];
    applyRedaction(rows, 'publishing_credentials');
    expect(originalRow.encrypted_password).toBe('secret-value');
    expect(originalRow.other).toBe('keep');
  });

  it('tolerates rows that lack some redacted columns', () => {
    // Different schemas may have subset of the canonical redacted
    // columns. applyRedaction must silently skip columns that aren't
    // present on a given row — never invent them, never throw.
    const rows = [
      { id: '1', encrypted_password: 'secret' }, // only one of the 4
      { id: '2', encrypted_api_key: 'key' }, // different subset
      { id: '3' }, // none
    ];
    const result = applyRedaction(rows, 'publishing_credentials');
    expect(result[0].encrypted_password).toBe('[REDACTED]');
    expect(result[0]).not.toHaveProperty('encrypted_api_key');
    expect(result[1].encrypted_api_key).toBe('[REDACTED]');
    expect(result[1]).not.toHaveProperty('encrypted_password');
    expect(result[2]).toEqual({ id: '3' });
  });

  it('applies redaction to store_author_credentials too', () => {
    const rows = [{ encrypted_password: 'sensitive' }];
    const result = applyRedaction(rows, 'store_author_credentials');
    expect(result[0].encrypted_password).toBe('[REDACTED]');
  });

  it('returns empty array unchanged', () => {
    const rows: Array<Record<string, unknown>> = [];
    const result = applyRedaction(rows, 'publishing_credentials');
    expect(result).toEqual([]);
  });
});

describe('lib/compliance-fulfil — USER_SCOPED_TABLES registry', () => {
  it('has no duplicate table names', () => {
    const names = USER_SCOPED_TABLES.map((s) => s.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('every entry uses an allowed userColumn value', () => {
    // The fulfilExportRequest loop depends on this constraint. If a
    // new userColumn value creeps in (e.g. 'member_id'), the type
    // system would already catch it — but an explicit runtime
    // assertion doubles as documentation and safety for the registry
    // JSON that gets included in every export's _metadata block.
    const allowed = new Set(['user_id', 'author_id', 'owner_id']);
    for (const spec of USER_SCOPED_TABLES) {
      expect(allowed.has(spec.userColumn)).toBe(true);
    }
  });

  it('is ordered alphabetically by table name', () => {
    // Alphabetical order is the contract that makes the generated
    // JSON deterministic across runs. A subtle reordering here could
    // silently shift per-run output without anyone noticing.
    const names = USER_SCOPED_TABLES.map((s) => s.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('contains a reasonable minimum number of tables', () => {
    // Canary against accidental truncation — if someone reduces the
    // registry drastically (e.g. to only 5 tables during a refactor),
    // this catches it before deployment. The floor is set well below
    // the current 44 to avoid false alarms during legitimate pruning.
    expect(USER_SCOPED_TABLES.length).toBeGreaterThanOrEqual(30);
  });

  it('includes the core tables the founder expects in every export', () => {
    // These 5 are the data every author expects to get back: their
    // projects, the interviews that shaped them, their credit history,
    // their platform usage, and their consent records.
    const names = new Set(USER_SCOPED_TABLES.map((s) => s.name));
    expect(names.has('projects')).toBe(true);
    expect(names.has('interview_sessions')).toBe(true);
    expect(names.has('credit_transactions')).toBe(true);
    expect(names.has('usage')).toBe(true);
    expect(names.has('consent_records')).toBe(true);
  });

  it('includes the compliance-tracking tables themselves (GDPR Art 20 + 17 logs)', () => {
    // Users are entitled to see the history of their own DSR requests
    // — it's literally the audit trail of their rights being exercised.
    const names = new Set(USER_SCOPED_TABLES.map((s) => s.name));
    expect(names.has('data_deletion_requests')).toBe(true);
    expect(names.has('data_exports')).toBe(true);
  });
});

describe('lib/compliance-fulfil — REDACTED_COLUMNS_BY_TABLE', () => {
  it('every redacted table exists in USER_SCOPED_TABLES', () => {
    // If someone retires a table from the registry but forgets to
    // clean up its redaction rules, the rules become dead code. Not
    // dangerous, but noise. Also catches typos in table names.
    const registryNames = new Set(USER_SCOPED_TABLES.map((s) => s.name));
    for (const tableName of Object.keys(REDACTED_COLUMNS_BY_TABLE)) {
      expect(registryNames.has(tableName)).toBe(true);
    }
  });

  it('every redacted column name starts with "encrypted_" (pattern contract)', () => {
    // Redaction is specifically for columns that hold ciphertext of
    // secrets. If a non-encrypted column name sneaks in, it's either
    // a typo or a category error — the redaction list isn't for
    // general privacy concerns, it's specifically for the encrypted
    // credential columns. General privacy redaction would need
    // different semantics (and probably stricter handling than
    // '[REDACTED]' sentinel).
    for (const cols of Object.values(REDACTED_COLUMNS_BY_TABLE)) {
      for (const col of cols) {
        expect(col.startsWith('encrypted_')).toBe(true);
      }
    }
  });

  it('has no empty redaction lists', () => {
    // An empty list means the entry should just be removed — it's a
    // no-op that pretends to be protective.
    for (const cols of Object.values(REDACTED_COLUMNS_BY_TABLE)) {
      expect(cols.length).toBeGreaterThan(0);
    }
  });
});
