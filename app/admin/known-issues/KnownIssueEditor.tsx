'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NORA_TIER_1_TOOL_NAMES } from '@/lib/nora/tool-names';

/**
 * Task 2.5 — KnownIssueEditor.
 *
 * Edits nora_known_issues rows. Fields per pre-flight confirmation:
 *   pattern_slug, title, surface, symptom_keywords text[],
 *   diagnostic_sql text, resolution_playbook text,
 *   auto_fix_tool text, auto_fix_tier int (1/2/3),
 *   escalate_after_attempts int (default 2),
 *   active bool
 *
 * The auto_fix_tool dropdown is populated from
 * lib/nora/tool-names.NORA_TIER_1_TOOL_NAMES per pre-flight R1 —
 * hardcoded now for forward-compat so patterns authored today wire up
 * to Nora tools when Nora ships.
 *
 * SQL syntax validation runs client-side via a small server route that
 * substitutes placeholder binds and runs EXPLAIN. Semantic validity
 * (does this query actually return useful data?) is the author's job —
 * we only catch syntax errors here.
 */

type Mode = 'create' | 'edit';

interface Pattern {
  id: string;
  pattern_slug: string;
  title: string;
  surface: string | null;
  symptom_keywords: string[] | null;
  diagnostic_sql: string | null;
  resolution_playbook: string | null;
  auto_fix_tool: string | null;
  auto_fix_tier: number | null;
  escalate_after_attempts: number;
  active: boolean;
}

const SURFACE_OPTIONS = ['author', 'guild', 'store', 'admin', 'all'];

export function KnownIssueEditor({
  mode,
  pattern,
}: {
  mode: Mode;
  pattern?: Pattern;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState(pattern?.pattern_slug ?? '');
  const [title, setTitle] = useState(pattern?.title ?? '');
  const [surface, setSurface] = useState(pattern?.surface ?? 'all');
  const [keywordsInput, setKeywordsInput] = useState(
    (pattern?.symptom_keywords ?? []).join(', '),
  );
  const [diagnosticSql, setDiagnosticSql] = useState(
    pattern?.diagnostic_sql ?? '',
  );
  const [playbook, setPlaybook] = useState(pattern?.resolution_playbook ?? '');
  const [autoFixTool, setAutoFixTool] = useState(pattern?.auto_fix_tool ?? '');
  const [autoFixTier, setAutoFixTier] = useState<number | null>(
    pattern?.auto_fix_tier ?? 1,
  );
  const [escalateAfter, setEscalateAfter] = useState<number>(
    pattern?.escalate_after_attempts ?? 2,
  );
  const [active, setActive] = useState<boolean>(pattern?.active ?? true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sqlValidation, setSqlValidation] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'ok' }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  async function validateSql() {
    if (diagnosticSql.trim().length === 0) {
      setSqlValidation({ status: 'idle' });
      return;
    }
    setSqlValidation({ status: 'checking' });
    try {
      const res = await fetch('/api/admin/known-issues/validate-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: diagnosticSql }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSqlValidation({
          status: 'error',
          message: json.error || `Failed (${res.status})`,
        });
      } else if (json.ok === false) {
        setSqlValidation({ status: 'error', message: json.error || 'Syntax error' });
      } else {
        setSqlValidation({ status: 'ok' });
      }
    } catch (e: any) {
      setSqlValidation({ status: 'error', message: e?.message || 'Validation failed' });
    }
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);

    if (slug.trim().length === 0) return setError('pattern_slug is required');
    if (title.trim().length === 0) return setError('title is required');

    setSubmitting(true);
    try {
      const keywords = keywordsInput
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      const payload = {
        pattern_slug: slug.trim(),
        title: title.trim(),
        surface: surface || null,
        symptom_keywords: keywords,
        diagnostic_sql: diagnosticSql.trim() || null,
        resolution_playbook: playbook.trim() || null,
        auto_fix_tool: autoFixTool.trim() || null,
        auto_fix_tier: autoFixTool.trim() ? autoFixTier : null,
        escalate_after_attempts: escalateAfter,
        active,
      };

      if (mode === 'create') {
        const res = await fetch('/api/admin/known-issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        setSuccess('Pattern created.');
        router.push(`/admin/known-issues/${json.data.id}`);
      } else {
        const res = await fetch(`/api/admin/known-issues/${pattern!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        setSuccess('Saved.');
        startTransition(() => router.refresh());
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      {(error || success) && (
        <div
          className={`rounded-md border p-3 text-sm ${
            error
              ? 'border-red-500/40 bg-red-500/10 text-red-400'
              : 'border-green-500/40 bg-green-500/10 text-green-400'
          }`}
        >
          {error || success}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Pattern slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={mode === 'edit'}
            placeholder="e.g. payout_method_missing"
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Surface</span>
          <select
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {SURFACE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">
            Escalate after N failed attempts
          </span>
          <input
            type="number"
            min={1}
            max={10}
            value={escalateAfter}
            onChange={(e) => setEscalateAfter(parseInt(e.target.value, 10) || 2)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs uppercase text-muted-foreground">
          Symptom keywords (comma-separated — Nora matches user messages
          against this list)
        </span>
        <input
          type="text"
          value={keywordsInput}
          onChange={(e) => setKeywordsInput(e.target.value)}
          placeholder="e.g. can't log in, password, 2fa, locked out"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground">
            Diagnostic SQL (use <code>:user_id</code>, <code>:tenant</code> binds)
          </span>
          <button
            type="button"
            onClick={validateSql}
            disabled={sqlValidation.status === 'checking' || diagnosticSql.trim().length === 0}
            className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {sqlValidation.status === 'checking' ? 'Checking…' : 'Validate syntax'}
          </button>
        </div>
        <textarea
          value={diagnosticSql}
          onChange={(e) => {
            setDiagnosticSql(e.target.value);
            setSqlValidation({ status: 'idle' });
          }}
          rows={8}
          placeholder="SELECT ... FROM ... WHERE user_id = :user_id"
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
        />
        {sqlValidation.status === 'ok' && (
          <div className="mt-1 text-xs text-green-500">Syntax OK.</div>
        )}
        {sqlValidation.status === 'error' && (
          <div className="mt-1 text-xs text-red-400">{sqlValidation.message}</div>
        )}
      </div>

      <label className="block">
        <span className="text-xs uppercase text-muted-foreground">
          Resolution playbook (what Nora says / does)
        </span>
        <textarea
          value={playbook}
          onChange={(e) => setPlaybook(e.target.value)}
          rows={6}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Auto-fix tool</span>
          <select
            value={autoFixTool}
            onChange={(e) => setAutoFixTool(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">— none —</option>
            {NORA_TIER_1_TOOL_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Nora's real tool registry doesn't exist yet; these names are
            pre-declared so patterns authored now wire up when it ships.
          </span>
        </label>

        <label className="block">
          <span className="text-xs uppercase text-muted-foreground">Tier</span>
          <select
            value={autoFixTier ?? 1}
            onChange={(e) => setAutoFixTier(parseInt(e.target.value, 10))}
            disabled={!autoFixTool}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value={1}>1 — safe auto-execute</option>
            <option value={2}>2 — admin-approval required</option>
            <option value={3}>3 — human-only</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">Active</span>
        </label>
      </div>

      <div className="flex items-center justify-end border-t pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting || pending}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : mode === 'create' ? 'Create pattern' : 'Save'}
        </button>
      </div>
    </div>
  );
}
