'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types mirror the v_guild_interview_grading_queue columns. Keep loose —
// values from the view may arrive with PG defaults (e.g. empty jsonb objects).
// ---------------------------------------------------------------------------
export interface GradingQueueRow {
  application_id: string;
  email: string;
  full_name: string;
  country: string | null;
  primary_language: string | null;
  motivation_statement: string | null;
  auto_review_score: number | null;
  applied_at: string | null;
  interview_id: string;
  scheduled_at: string | null;
  conducted_at: string | null;
  duration_seconds: number | null;
  interview_language: string | null;
  transcript: string | null;
  summary: string | null;
  scores: Record<string, number | string> | null;
  rubric_result: string | null;
  reviewer_notes: string | null;
  ready_to_grade: boolean;
  ready_to_accept: boolean;
  days_since_interview: number | null;
}

interface Props {
  toGrade: GradingQueueRow[];
  readyToAccept: GradingQueueRow[];
}

/**
 * Interview Grading Queue — the admin surface for the two post-interview
 * steps, rendered as a single connected section at the top of the Guild
 * Applications page.
 *
 * Left: rows awaiting rubric grading (pass/fail decision).
 * Right: rows already graded 'pass' and awaiting final acceptance.
 *
 * Both sections re-fetch by calling router.refresh() after a successful
 * mutation. The view query lives server-side on the parent page, so a refresh
 * re-runs the query and moves rows to the correct bucket.
 */
export default function GradingQueue({ toGrade, readyToAccept }: Props) {
  if (toGrade.length === 0 && readyToAccept.length === 0) {
    return null;
  }

  return (
    <div className="mb-10 rounded-lg border border-[#d4af37]/30 bg-gradient-to-br from-[#d4af37]/5 to-transparent p-6">
      <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Guild Council
      </div>
      <h2 className="mb-1 font-serif text-2xl">Interview Grading Queue</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Rows requiring Council action. Grade completed interviews, then finalize
        acceptance to reveal the member&apos;s referral code.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: awaiting rubric grading */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-500" />
            <span>To grade ({toGrade.length})</span>
          </div>
          {toGrade.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No interviews awaiting a rubric decision.
            </div>
          ) : (
            <div className="space-y-3">
              {toGrade.map((row) => (
                <GradeCard key={row.interview_id} row={row} />
              ))}
            </div>
          )}
        </div>

        {/* Right: ready to finalize */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span>Ready to accept ({readyToAccept.length})</span>
          </div>
          {readyToAccept.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No members awaiting final acceptance.
            </div>
          ) : (
            <div className="space-y-3">
              {readyToAccept.map((row) => (
                <AcceptCard key={row.interview_id} row={row} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade card — pass/fail modal
// ---------------------------------------------------------------------------
function GradeCard({ row }: { row: GradingQueueRow }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [modal, setModal] = useState<null | 'pass' | 'fail'>(null);

  const duration = formatDuration(row.duration_seconds);
  const relativeDate = formatRelativeDays(row.days_since_interview);
  const transcript = row.transcript || '(no transcript on file)';
  const truncatedTranscript =
    transcript.length > 400 ? transcript.slice(0, 400) + '…' : transcript;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.full_name}</div>
          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        </div>
        <div className="flex-shrink-0 text-right text-xs text-muted-foreground">
          <div>{relativeDate}</div>
          {row.country && <div>{row.country}</div>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {row.interview_language && (
          <span>
            Language: <span className="uppercase">{row.interview_language}</span>
          </span>
        )}
        {duration && <span>Duration: {duration}</span>}
      </div>

      {row.summary && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Summary
          </div>
          <div className="text-sm leading-relaxed">{row.summary}</div>
        </div>
      )}

      {row.scores && Object.keys(row.scores).length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Scores
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-background p-3 text-xs">
            {Object.entries(row.scores).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="capitalize text-muted-foreground">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="font-mono">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setTranscriptOpen((o) => !o)}
          className="text-xs text-[#d4af37] hover:underline"
        >
          {transcriptOpen ? '− Hide transcript' : '+ Show transcript'}
        </button>
        {transcriptOpen && (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-relaxed">
            {transcript}
          </pre>
        )}
        {!transcriptOpen && transcript.length > 400 && (
          <div className="mt-2 rounded-md bg-background p-3 text-xs leading-relaxed text-muted-foreground">
            {truncatedTranscript}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setModal('pass')}
          className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Pass
        </button>
        <button
          type="button"
          onClick={() => setModal('fail')}
          className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Fail
        </button>
      </div>

      {modal && (
        <GradeModal
          row={row}
          result={modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade modal — reviewer-notes textarea + submit
// ---------------------------------------------------------------------------
function GradeModal({
  row,
  result,
  onClose,
}: {
  row: GradingQueueRow;
  result: 'pass' | 'fail';
  onClose: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/guild/admin/grade-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interview_id: row.interview_id,
          result,
          reviewer_notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      onClose();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  const heading = result === 'pass' ? 'Pass rubric' : 'Fail rubric';
  const hint =
    result === 'fail'
      ? 'Optional — this will be recorded as the decision reason on the application.'
      : 'Optional — visible only to the Council.';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-serif text-xl">{heading}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {row.full_name} · {row.email}
        </p>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Reviewer notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="mb-2 w-full rounded-md border border-border bg-background p-3 text-sm focus:border-[#d4af37] focus:outline-none"
          placeholder={result === 'fail' ? 'e.g. Low commitment signal; vague on market.' : 'e.g. Strong voice, clear audience.'}
          disabled={submitting}
        />
        <p className="mb-4 text-xs text-muted-foreground">{hint}</p>

        {err && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
              result === 'pass'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {submitting ? 'Submitting…' : result === 'pass' ? 'Confirm Pass' : 'Confirm Fail'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accept card — single-click finalize (guild_finalize_acceptance)
// ---------------------------------------------------------------------------
function AcceptCard({ row }: { row: GradingQueueRow }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const relativeDate = formatRelativeDays(row.days_since_interview);

  async function submit() {
    if (!confirm(`Finalize acceptance for ${row.full_name}? This will create the Guild member row, reveal the referral code, and send the welcome email.`)) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/guild/admin/finalize-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: row.application_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'Unknown error');
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.full_name}</div>
          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        </div>
        <div className="flex-shrink-0 text-right text-xs text-muted-foreground">
          <div>Graded {relativeDate}</div>
          {row.country && <div>{row.country}</div>}
        </div>
      </div>

      {row.reviewer_notes && (
        <div className="mb-3 rounded-md bg-background p-3 text-xs italic leading-relaxed">
          &ldquo;{row.reviewer_notes}&rdquo;
        </div>
      )}

      {err && (
        <div className="mb-3 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-500">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? 'Finalizing…' : 'Finalize acceptance'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined || seconds < 0) return null;
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function formatRelativeDays(days: number | null): string {
  if (days === null || days === undefined) return 'recently';
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${Math.round(days)} days ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
