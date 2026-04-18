'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';

const COUNTRIES = [
  'Australia', 'United States', 'United Kingdom', 'Canada', 'New Zealand',
  'India', 'Philippines', 'Vietnam', 'Thailand', 'Indonesia', 'Malaysia',
  'Singapore', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal',
  'United Arab Emirates', 'Saudi Arabia', 'Egypt', 'Morocco', 'Jordan', 'Lebanon',
  'Nigeria', 'Kenya', 'South Africa', 'Ghana', 'Ethiopia',
  'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Poland', 'Portugal',
  'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru',
  'Russia', 'Ukraine', 'Turkey',
  'China', 'Japan', 'South Korea',
  'Other',
];

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español (Spanish)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'pt', label: 'Português (Portuguese)' },
  { code: 'fr', label: 'Français (French)' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'ru', label: 'Русский (Russian)' },
  { code: 'zh', label: '中文 (Chinese)' },
];

const REASONS = [
  { value: 'side_income', label: 'Earn a side income' },
  { value: 'marketing_career', label: 'Build a career in marketing' },
  { value: 'serve_community', label: 'Serve and support my community' },
  { value: 'learn_skills', label: 'Learn marketing skills' },
  { value: 'other', label: 'Something else' },
];

interface FormState {
  full_name: string;
  email: string;
  country: string;
  primary_language: string;
  reason: string;
  reason_other: string;
  social_links: string[];
  motivation_statement: string;
  referred_by_code: string;
  agreed_to_terms: boolean;
}

export default function GuildApplyPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    full_name: '',
    email: '',
    country: '',
    primary_language: 'en',
    reason: '',
    reason_other: '',
    social_links: [''],
    motivation_statement: '',
    referred_by_code: '',
    agreed_to_terms: false,
  });

  // Session awareness: if the visitor is already signed in to Penworth,
  // pre-fill and lock the email so the application cannot be submitted
  // under a different address than the one they'll sign in with.
  // authedEmail === null  → not signed in (or still loading)
  // authedEmail === ''    → session check completed, not authenticated
  // authedEmail === 'x@y' → authenticated, email locked to this value
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const email = data.user?.email || '';
      setAuthedEmail(email);
      if (email) {
        setForm((f) => ({ ...f, email }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const addSocialLink = () => {
    if (form.social_links.length < 5) {
      update('social_links', [...form.social_links, '']);
    }
  };

  const updateSocialLink = (i: number, value: string) => {
    const next = [...form.social_links];
    next[i] = value;
    update('social_links', next);
  };

  const canStep1 =
    form.full_name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) &&
    form.country.length > 0 &&
    form.primary_language.length > 0;

  const canStep2 =
    form.reason.length > 0 &&
    (form.reason !== 'other' || form.reason_other.trim().length > 3);

  const canSubmit =
    form.motivation_statement.trim().length >= 40 && form.agreed_to_terms;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const filteredLinks = form.social_links.map((l) => l.trim()).filter(Boolean);
      const res = await fetch('/api/guild/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          country: form.country,
          primary_language: form.primary_language,
          reason: form.reason,
          reason_other: form.reason === 'other' ? form.reason_other.trim() : null,
          social_links: filteredLinks,
          motivation_statement: form.motivation_statement.trim(),
          referred_by_code: form.referred_by_code.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Unable to submit application.');
      }
      router.push(`/guild/thank-you?id=${encodeURIComponent(json.application_id)}`);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-12">
        <Link
          href="/guild"
          className="text-sm text-[#8a8370] hover:text-[#e7e2d4]"
        >
          ← Back to the Guild
        </Link>
      </div>

      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Step {step} of 3
      </div>
      <h1 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
        {step === 1 && "Let's start with who you are."}
        {step === 2 && 'Why the Guild?'}
        {step === 3 && 'Tell us about yourself.'}
      </h1>
      <p className="mt-4 text-base text-[#8a8370]">
        {step === 1 && 'Basic information — takes under a minute.'}
        {step === 2 && 'So we can understand your motivation.'}
        {step === 3 && "Share a little about who you are and who you'd introduce to Penworth."}
      </p>

      {/* Progress bar */}
      <div className="mt-10 flex gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1 flex-1 rounded-full transition ${
              step >= n ? 'bg-[#d4af37]' : 'bg-[#1e2436]'
            }`}
          />
        ))}
      </div>

      <div className="mt-12 rounded-xl border border-[#1e2436] bg-[#0f1424] p-8 md:p-10">
        {step === 1 && (
          <div className="space-y-6">
            <Field label="Full name" required>
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                placeholder="Maria Santos"
                className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
              />
            </Field>

            <Field label="Email address" required>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                readOnly={!!authedEmail}
                disabled={!!authedEmail}
                placeholder="you@example.com"
                className={`w-full rounded-md border border-[#2a3149] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37] ${
                  authedEmail
                    ? 'cursor-not-allowed bg-[#0f1424] opacity-75'
                    : 'bg-[#0a0e1a]'
                }`}
              />
              {authedEmail ? (
                <p className="mt-2 text-xs text-[#8a8370]">
                  Applying as <span className="text-[#e7e2d4]">{authedEmail}</span>.{' '}
                  <button
                    type="button"
                    onClick={async () => {
                      const supabase = createBrowserSupabase();
                      await supabase.auth.signOut();
                      setAuthedEmail('');
                      setForm((f) => ({ ...f, email: '' }));
                      router.refresh();
                    }}
                    className="text-[#d4af37] hover:underline"
                  >
                    Sign out
                  </button>{' '}
                  to apply with a different address.
                </p>
              ) : authedEmail === '' ? (
                <p className="mt-2 text-xs text-[#6b6452]">
                  Used for your Guildmember account and all Guild communications.
                  {' '}
                  <Link
                    href="/login?next=/guild/apply"
                    className="text-[#d4af37] hover:underline"
                  >
                    Already have a Penworth account? Sign in first →
                  </Link>
                </p>
              ) : (
                <p className="mt-2 text-xs text-[#6b6452]">
                  Used for your Guildmember account and all Guild communications.
                </p>
              )}
            </Field>

            <div className="grid gap-6 md:grid-cols-2">
              <Field label="Country" required>
                <select
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] outline-none focus:border-[#d4af37]"
                >
                  <option value="">Select your country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Primary language" required>
                <select
                  value={form.primary_language}
                  onChange={(e) => update('primary_language', e.target.value)}
                  className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] outline-none focus:border-[#d4af37]"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#6b6452]">
                  Your voice interview and support will be in this language.
                </p>
              </Field>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                disabled={!canStep1}
                onClick={() => setStep(2)}
                className="rounded-md bg-[#d4af37] px-8 py-3 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <Field label="What brings you to the Guild?" required>
              <div className="space-y-2">
                {REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition ${
                      form.reason === r.value
                        ? 'border-[#d4af37] bg-[#d4af37]/5'
                        : 'border-[#2a3149] bg-[#0a0e1a] hover:border-[#3a4259]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      checked={form.reason === r.value}
                      onChange={(e) => update('reason', e.target.value)}
                      className="accent-[#d4af37]"
                    />
                    <span className="text-sm text-[#e7e2d4]">{r.label}</span>
                  </label>
                ))}
              </div>
            </Field>

            {form.reason === 'other' && (
              <Field label="Tell us more">
                <input
                  type="text"
                  value={form.reason_other}
                  onChange={(e) => update('reason_other', e.target.value)}
                  placeholder="In a few words, what brought you to the Guild?"
                  className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
                />
              </Field>
            )}

            <Field label="Did someone refer you?" optional>
              <input
                type="text"
                value={form.referred_by_code}
                onChange={(e) => update('referred_by_code', e.target.value.toUpperCase())}
                placeholder="GUILD-USERNAME (optional)"
                className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
              />
              <p className="mt-2 text-xs text-[#6b6452]">
                If a current Guildmember pointed you here, their code gives them recognition (not
                commission) for introducing you.
              </p>
            </Field>

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-[#2a3149] bg-transparent px-6 py-3 text-sm text-[#c9c2b0] hover:border-[#3a4259]"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!canStep2}
                onClick={() => setStep(3)}
                className="rounded-md bg-[#d4af37] px-8 py-3 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <Field label="Links to your online presence" optional>
              <div className="space-y-2">
                {form.social_links.map((link, i) => (
                  <input
                    key={i}
                    type="url"
                    value={link}
                    onChange={(e) => updateSocialLink(i, e.target.value)}
                    placeholder={
                      i === 0
                        ? 'e.g. https://linkedin.com/in/yourname'
                        : 'Add another link (optional)'
                    }
                    className="w-full rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
                  />
                ))}
                {form.social_links.length < 5 && (
                  <button
                    type="button"
                    onClick={addSocialLink}
                    className="text-xs text-[#d4af37] hover:text-[#e6c14a]"
                  >
                    + Add another link
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-[#6b6452]">
                LinkedIn, Instagram, TikTok, YouTube, personal website — anything public that
                represents you. Optional but strongly recommended: it helps your Scout agent learn
                your audience from day one.
              </p>
            </Field>

            <Field label="Why do you want to join the Guild?" required>
              <textarea
                value={form.motivation_statement}
                onChange={(e) => update('motivation_statement', e.target.value)}
                rows={5}
                placeholder="Two or three sentences about who you are, who your people are, and what you hope to build here."
                className="w-full resize-none rounded-md border border-[#2a3149] bg-[#0a0e1a] px-4 py-3 text-[#e7e2d4] placeholder-[#6b6452] outline-none focus:border-[#d4af37]"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-[#6b6452]">
                  Minimum 40 characters · This is read by the Guild Council during review.
                </p>
                <span
                  className={`text-xs ${
                    form.motivation_statement.length >= 40 ? 'text-[#d4af37]' : 'text-[#6b6452]'
                  }`}
                >
                  {form.motivation_statement.length}
                </span>
              </div>
            </Field>

            <label className="flex cursor-pointer items-start gap-3 pt-4">
              <input
                type="checkbox"
                checked={form.agreed_to_terms}
                onChange={(e) => update('agreed_to_terms', e.target.checked)}
                className="mt-1 accent-[#d4af37]"
              />
              <span className="text-sm leading-relaxed text-[#c9c2b0]">
                I have read and agree to the{' '}
                <Link
                  href="/guild/terms"
                  target="_blank"
                  className="text-[#d4af37] hover:underline"
                >
                  Guildmember Agreement
                </Link>{' '}
                and{' '}
                <Link
                  href="/guild/privacy"
                  target="_blank"
                  className="text-[#d4af37] hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </label>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={submitting}
                className="rounded-md border border-[#2a3149] bg-transparent px-6 py-3 text-sm text-[#c9c2b0] hover:border-[#3a4259] disabled:opacity-40"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={submit}
                className="rounded-md bg-[#d4af37] px-8 py-3 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit Application'}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-xs text-[#6b6452]">
        Your data is encrypted in transit and at rest. We never share your information.
      </p>
    </div>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-[#e7e2d4]">
        {label}
        {required && <span className="ml-1 text-[#d4af37]">*</span>}
        {optional && <span className="ml-2 text-xs font-normal text-[#6b6452]">(optional)</span>}
      </label>
      {children}
    </div>
  );
}
