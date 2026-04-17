'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type QuizQuestion = {
  q: string;
  options: string[];
  correct_index: number;
};

type Quiz = {
  questions: QuizQuestion[];
  pass_threshold?: number; // minimum correct answers; defaults to all correct
};

export default function ModuleContent({
  moduleId,
  moduleSlug,
  contentMarkdown,
  quiz,
  alreadyCompleted,
}: {
  moduleId: string;
  moduleSlug: string;
  contentMarkdown: string;
  quiz: Quiz | null;
  alreadyCompleted: boolean;
}) {
  return (
    <div className="space-y-12">
      <article className="prose prose-invert prose-headings:font-serif prose-headings:tracking-tight prose-a:text-[#d4af37] prose-strong:text-[#e7e2d4] prose-code:text-[#d4af37] prose-code:before:content-none prose-code:after:content-none max-w-none text-[#c9c2b0]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentMarkdown}</ReactMarkdown>
      </article>

      {quiz && quiz.questions && quiz.questions.length > 0 ? (
        <QuizBlock
          moduleId={moduleId}
          moduleSlug={moduleSlug}
          quiz={quiz}
          alreadyCompleted={alreadyCompleted}
        />
      ) : (
        <CompleteWithoutQuiz
          moduleId={moduleId}
          moduleSlug={moduleSlug}
          alreadyCompleted={alreadyCompleted}
        />
      )}
    </div>
  );
}

function CompleteWithoutQuiz({
  moduleId,
  moduleSlug,
  alreadyCompleted,
}: {
  moduleId: string;
  moduleSlug: string;
  alreadyCompleted: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyCompleted) {
    return (
      <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-6 text-center">
        <div className="font-serif text-xl tracking-tight text-[#d4af37]">Module complete</div>
        <p className="mt-2 text-sm text-[#c9c2b0]">You&apos;ve finished this one.</p>
        <Link
          href="/guild/dashboard/academy"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-5 py-2 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
        >
          ← Back to Academy
        </Link>
      </div>
    );
  }

  async function handleComplete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/guild/academy/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: moduleId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Failed to mark complete');
      }
      router.push('/guild/dashboard/academy');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Mark as complete
      </div>
      <p className="text-sm leading-relaxed text-[#c9c2b0]">
        When you&apos;ve read and absorbed this module, mark it complete to continue.
      </p>
      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <button
        onClick={handleComplete}
        disabled={submitting}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a] disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Mark complete'}
      </button>
    </div>
  );
}

function QuizBlock({
  moduleId,
  moduleSlug,
  quiz,
  alreadyCompleted,
}: {
  moduleId: string;
  moduleSlug: string;
  quiz: Quiz;
  alreadyCompleted: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    passed: boolean;
    score: number;
    total: number;
    threshold: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const threshold = quiz.pass_threshold ?? quiz.questions.length;

  function setAnswer(qIdx: number, optIdx: number) {
    if (result?.passed) return;
    setAnswers((a) => ({ ...a, [qIdx]: optIdx }));
  }

  async function handleSubmit() {
    if (Object.keys(answers).length < quiz.questions.length) {
      setError('Please answer every question before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);

    // Score locally for immediate feedback
    let correct = 0;
    quiz.questions.forEach((q, i) => {
      if (answers[i] === q.correct_index) correct++;
    });
    const passed = correct >= threshold;
    setResult({ passed, score: correct, total: quiz.questions.length, threshold });

    if (!passed) {
      setSubmitting(false);
      return;
    }

    // Persist completion
    try {
      const res = await fetch('/api/guild/academy/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_id: moduleId, quiz_score: correct }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Failed to save progress');
      }
    } catch (e: any) {
      setError(`Quiz passed but progress didn't save: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setAnswers({});
    setResult(null);
    setError(null);
  }

  if (alreadyCompleted && !result) {
    return (
      <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-6 text-center">
        <div className="font-serif text-xl tracking-tight text-[#d4af37]">Quiz passed</div>
        <p className="mt-2 text-sm text-[#c9c2b0]">You&apos;ve already completed this module.</p>
        <Link
          href="/guild/dashboard/academy"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-5 py-2 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
        >
          ← Back to Academy
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Quick check
      </div>
      <h3 className="font-serif text-2xl tracking-tight">
        Answer these to complete the module.
      </h3>
      <p className="mt-1 text-sm text-[#8a8370]">
        {threshold === quiz.questions.length
          ? 'All answers correct to pass.'
          : `${threshold} of ${quiz.questions.length} correct to pass.`}
      </p>

      <div className="mt-8 space-y-8">
        {quiz.questions.map((q, qIdx) => (
          <QuizQuestionBlock
            key={qIdx}
            index={qIdx}
            question={q}
            selected={answers[qIdx]}
            locked={!!result?.passed}
            showFeedback={!!result}
            onSelect={(optIdx) => setAnswer(qIdx, optIdx)}
          />
        ))}
      </div>

      {result && (
        <div
          className={`mt-8 rounded-md border px-4 py-3 text-sm ${
            result.passed
              ? 'border-[#d4af37]/40 bg-[#d4af37]/10 text-[#d4af37]'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {result.passed ? (
            <>
              <strong>Passed.</strong> You got {result.score} of {result.total} correct. Progress
              saved.
            </>
          ) : (
            <>
              <strong>Not yet.</strong> You got {result.score} of {result.total} correct — you need{' '}
              {result.threshold}. Review the material and try again.
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-8 flex gap-3">
        {!result && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a] disabled:opacity-50"
          >
            {submitting ? 'Checking…' : 'Submit answers'}
          </button>
        )}
        {result && !result.passed && (
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
          >
            Try again
          </button>
        )}
        {result?.passed && (
          <Link
            href="/guild/dashboard/academy"
            className="inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a]"
          >
            Back to Academy →
          </Link>
        )}
      </div>
    </div>
  );
}

function QuizQuestionBlock({
  index,
  question,
  selected,
  locked,
  showFeedback,
  onSelect,
}: {
  index: number;
  question: QuizQuestion;
  selected: number | undefined;
  locked: boolean;
  showFeedback: boolean;
  onSelect: (optIdx: number) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-serif text-lg text-[#d4af37]">{index + 1}.</span>
        <span className="text-base leading-relaxed text-[#e7e2d4]">{question.q}</span>
      </div>
      <div className="space-y-2">
        {question.options.map((opt, optIdx) => {
          const isSelected = selected === optIdx;
          const isCorrect = optIdx === question.correct_index;
          let classes =
            'w-full rounded-md border px-4 py-3 text-left text-sm transition cursor-pointer ';
          if (showFeedback) {
            if (isCorrect) {
              classes += 'border-[#d4af37]/50 bg-[#d4af37]/10 text-[#d4af37]';
            } else if (isSelected && !isCorrect) {
              classes += 'border-red-500/40 bg-red-500/10 text-red-300';
            } else {
              classes += 'border-[#1e2436] bg-[#0a0e1a] text-[#8a8370]';
            }
          } else if (isSelected) {
            classes += 'border-[#d4af37] bg-[#d4af37]/5 text-[#e7e2d4]';
          } else {
            classes += 'border-[#1e2436] bg-[#0a0e1a] text-[#c9c2b0] hover:border-[#2a3149]';
          }

          return (
            <button
              key={optIdx}
              type="button"
              disabled={locked}
              onClick={() => onSelect(optIdx)}
              className={classes}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
