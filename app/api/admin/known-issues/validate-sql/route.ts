import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/known-issues/validate-sql
 * Body: { sql: string }
 *
 * Lightweight pre-parse for diagnostic_sql entered in the known-issue
 * editor. Catches the common errors without needing to actually execute
 * the query against the database:
 *
 *   1. Must be a SELECT (no writes, no DDL, no multi-statement).
 *   2. Bind placeholders (:user_id, :tenant) must resolve — we do a
 *      textual substitution and report any unknown :name left after.
 *   3. Parenthesis balance check.
 *   4. Quoted-string termination check (so `WHERE x = '` doesn't slip
 *      past and mask other issues).
 *
 * Why not run EXPLAIN via a SECURITY DEFINER RPC? Because EXPLAIN can
 * still invoke side-effecting functions in function calls, and the
 * value of catching genuine parser errors vs this lightweight check is
 * marginal for admin-authored diagnostic queries. The real safety
 * check is "Nora's matcher runs this against the DB with a timeout" —
 * that's the enforcement layer.
 *
 * If a Postgres round-trip is needed later, the cleanest path is a
 * migration adding a SECURITY DEFINER fn that does:
 *   PREPARE _ki_check AS <substituted_sql>;
 *   DEALLOCATE _ki_check;
 * which parses but does not execute.
 */

const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'create',
  'grant', 'revoke', 'commit', 'rollback', 'vacuum', 'reindex', 'copy',
  'savepoint', 'begin', 'end', 'lock',
];

const KNOWN_BINDS = new Set([':user_id', ':tenant']);

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sql = typeof body.sql === 'string' ? body.sql.trim() : '';
  if (sql.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'sql is empty' },
      { status: 400 },
    );
  }

  // Strip single-line comments. Multi-line /* ... */ we handle below.
  const noComments = stripComments(sql);

  // Must start with SELECT or WITH (for CTE-wrapped SELECTs).
  const firstToken = noComments.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (firstToken !== 'select' && firstToken !== 'with') {
    return NextResponse.json(
      { ok: false, error: 'Query must be a SELECT (or WITH … SELECT)' },
      { status: 200 },
    );
  }

  // No unquoted semicolons — they could sneak in a second statement.
  // Allow trailing single semicolon though.
  const trimmedOnce = noComments.trim().replace(/;\s*$/, '');
  if (!isSingleStatement(trimmedOnce)) {
    return NextResponse.json(
      { ok: false, error: 'Multi-statement SQL is not allowed' },
      { status: 200 },
    );
  }

  // Forbidden keywords as whole tokens (outside quoted strings).
  const withoutStrings = stripStringLiterals(trimmedOnce).toLowerCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    // \b word boundary so UPDATE inside CHANGE_UPDATE_AT wouldn't flag
    const rx = new RegExp(`\\b${kw}\\b`, 'i');
    if (rx.test(withoutStrings)) {
      return NextResponse.json(
        { ok: false, error: `Forbidden keyword: ${kw.toUpperCase()}` },
        { status: 200 },
      );
    }
  }

  // Quoted-string termination + parenthesis balance.
  const bal = analyseBalance(trimmedOnce);
  if (!bal.ok) {
    return NextResponse.json(
      { ok: false, error: bal.error },
      { status: 200 },
    );
  }

  // Unknown binds? We recognise :user_id and :tenant; any other :name
  // that looks like a bind is surfaced so the author realizes Nora's
  // matcher won't know how to substitute it.
  const binds = extractBinds(withoutStrings);
  const unknown = binds.filter((b) => !KNOWN_BINDS.has(b));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown bind placeholder(s): ${unknown.join(', ')}. Known: :user_id, :tenant`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true });
}

function stripComments(sql: string): string {
  // /* ... */ block comments (non-nesting)
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // -- line comments
  out = out.replace(/--[^\n]*/g, ' ');
  return out;
}

function stripStringLiterals(sql: string): string {
  // Replace single-quoted strings with empty quotes so keyword detection
  // can ignore string content. Handles escaped quotes '' inside strings.
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function isSingleStatement(sql: string): boolean {
  // Any ; outside a quoted string makes this multi-statement.
  const stripped = stripStringLiterals(sql);
  return !stripped.includes(';');
}

function analyseBalance(
  sql: string,
): { ok: true } | { ok: false; error: string } {
  let parens = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inString) {
      if (c === "'") {
        // '' inside a string = escaped quote, stay in string
        if (sql[i + 1] === "'") {
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === '(') parens++;
    else if (c === ')') {
      parens--;
      if (parens < 0) return { ok: false, error: 'Unbalanced parentheses' };
    }
  }
  if (inString) return { ok: false, error: 'Unterminated string literal' };
  if (parens !== 0) return { ok: false, error: 'Unbalanced parentheses' };
  return { ok: true };
}

function extractBinds(sql: string): string[] {
  // Matches :name — lowercase, letters/digits/underscore, not preceded by
  // another letter (so "a:b" doesn't match, nor type casts "::text").
  const matches = sql.matchAll(/(?<![a-z0-9_:])(:[a-z_][a-z0-9_]*)/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}
