'use client';

import { useState } from 'react';
import Link from 'next/link';

interface StatusResult {
  found: boolean;
  id?: string;
  status?: string;
  submitted_at?: string;
  decided_at?: string | null;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; description: string }> = {
  pending_review: {
    label: 'Under Review',
    color: '#d4af37',
    description:
      'Your application has been received and is being reviewed. You should receive a decision email within 30 minutes of submission.',
  },
  invited_to_interview: {
    label: 'Interview Invited',
    color: '#d4af37',
    description:
      'Great news — your application passed the first round. Check your email for the booking link to schedule your 10-minute voice interview.',
  },
  interview_scheduled: {
    label: 'Interview Scheduled',
    color: '#d4af37',
    description:
      'Your voice interview is scheduled. Check your email for the confirmation and preparation notes.',
  },
  interview_completed: {
    label: 'Interview Completed',
    color: '#d4af37',
    description:
      'Your interview is complete and under review by the Guild Council. Decisions are typically made within 48 hours.',
  },
  accepted: {
    label: 'Accepted',
    color: '#8fbc8f',
    description:
      'Welcome to the Guild! Check your email for your welcome packet and dashboard access. If you haven\'t received it, check spam or email guild@penworth.ai.',
  },
  declined: {
    label: 'Not Accepted',
    color: '#8a8370',
    description:
      'On this occasion, your application was not successful. You are welcome to reapply in 90 days from your application date.',
  },
  auto_declined: {
    label: 'Not Accepted',
    color: '#8a8370',
    description:
      'Your application did not pass our automated review. You are welcome to reapply in 90 days with a stronger motivation statement and any public links you can share.',
  },
  withdrawn: {
    label: 'Withdrawn',
    color: '#8a8370',
    description: 'This application has been withdrawn.',
  },
};

export default function StatusPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/guild/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to check status.');
      }
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  const statusInfo = result?.status ? STATUS_DISPLAY[result.status] : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <div className="mb-12">
        <Link href="/guild" className="text-sm text-[#8a8370] hover:text-[#e7e2d4]">
          ← Back to the Guild
        </Link>
      </div>

      <h1 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        Check your <span className="italic text-[#d4af37]">application status</span>.
      </h1>
      <p className="mt-4 text-base text-[#8a8370]">
        Enter the email address you applied with.
      </p>

      <div className="mt-12 rounded-xl border border-[#1e2436] bg-[#0f1424] p-8">
        <label className="mb-2 block text-sm font-medium text-[#e7e2d4]">Email address</label>
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.trim()) check();
            }}
            placeholder="you@example.com"
            className="flex-1 rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
          />
          <button
            type="button"
            onClick={check}
            disabled={loading || !email.trim()}
            className="rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Checking…' : 'Check'}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && !result.found && (
          <div className="mt-8 rounded-md border border-[#2a3149] bg-[#0a0e1a] p-6 text-sm text-[#c9c2b0]">
            <div className="mb-3 font-medium text-[#e7e2d4]">
              No application found for {email}
            </div>
            <p>We couldn&apos;t find an application associated with this email address.</p>
            <Link
              href="/guild/apply"
              className="mt-4 inline-block text-[#d4af37] hover:underline"
            >
              Apply now →
            </Link>
          </div>
        )}

        {result && result.found && statusInfo && (
          <div className="mt-8 space-y-6">
            <div
              className="rounded-md border p-6"
              style={{
                borderColor: `${statusInfo.color}50`,
                background: `${statusInfo.color}08`,
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: statusInfo.color }}>
                Status
              </div>
              <div className="mt-2 font-serif text-3xl tracking-tight" style={{ color: statusInfo.color }}>
                {statusInfo.label}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[#c9c2b0]">{statusInfo.description}</p>
            </div>

            <div className="space-y-3 text-sm text-[#8a8370]">
              <div className="flex justify-between">
                <span>Submitted</span>
                <span className="text-[#c9c2b0]">
                  {result.submitted_at
                    ? new Date(result.submitted_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : '—'}
                </span>
              </div>
              {result.decided_at && (
                <div className="flex justify-between">
                  <span>Decision</span>
                  <span className="text-[#c9c2b0]">
                    {new Date(result.decided_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
              {result.id && (
                <div className="flex justify-between">
                  <span>Reference</span>
                  <span className="font-mono text-xs text-[#c9c2b0]">{result.id.slice(0, 8)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-[#6b6452]">
        Questions? Email <a href="mailto:guild@penworth.ai" className="text-[#d4af37] hover:underline">guild@penworth.ai</a>
      </p>
    </div>
  );
}
