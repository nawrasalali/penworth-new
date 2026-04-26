/**
 * Shared types + helpers for the Penworth Guild Academy v2 quiz engine.
 *
 * The quiz JSON stored in `guild_academy_modules.quiz` follows this shape:
 *   {
 *     version: 2,
 *     config: {
 *       pass_threshold_pct: 0.70,
 *       max_attempts: 3,
 *       lockout_days: 7,
 *       questions_served_per_attempt: 15,
 *     },
 *     checkpoints: [
 *       { after_segment, voice, question, options[4], correct_index, explanation }
 *     ],
 *     pool: [
 *       { n: 1, question, options[4], correct_index }
 *     ]
 *   }
 *
 * Per-member attempt state is in `guild_academy_progress`:
 *   - quiz_attempts (int, 0–max_attempts)
 *   - quiz_attempts_locked_until (timestamptz; non-null = locked)
 *   - attempt_history (jsonb array) — one entry per attempt
 */

export interface QuizConfig {
  pass_threshold_pct: number;
  max_attempts: number;
  lockout_days: number;
  questions_served_per_attempt: number;
}

export interface QuizPoolQuestion {
  n: number;
  question: string;
  options: string[];
  correct_index: number;
}

export interface QuizCheckpoint {
  after_segment: number;
  voice: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface QuizPayload {
  version: 2;
  config: QuizConfig;
  checkpoints: QuizCheckpoint[];
  pool: QuizPoolQuestion[];
}

export interface AttemptHistoryEntry {
  attempt_number: number;
  served_question_ns: number[];
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  total: number | null;
  passed: boolean | null;
}

/** Default config used when a module's quiz JSON is missing config (shouldn't happen post v2 migration). */
export const DEFAULT_CONFIG: QuizConfig = {
  pass_threshold_pct: 0.7,
  max_attempts: 3,
  lockout_days: 7,
  questions_served_per_attempt: 15,
};

export function getQuizConfig(quiz: QuizPayload | null | undefined): QuizConfig {
  return { ...DEFAULT_CONFIG, ...(quiz?.config ?? {}) };
}

/**
 * Cryptographically randomised Fisher-Yates shuffle using crypto.getRandomValues.
 * (Deterministic per-attempt persistence is achieved by storing the selected
 *  set in attempt_history, not by seeding the RNG.)
 */
export function pickRandomQuestions(pool: QuizPoolQuestion[], n: number): QuizPoolQuestion[] {
  const arr = [...pool];
  const len = arr.length;
  if (n >= len) return arr;
  const buf = new Uint32Array(len);
  // Web Crypto is available in Node 18+ and Edge; fall back to Math.random in unlikely absence.
  const rng = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? () => { crypto.getRandomValues(buf.subarray(0, 1)); return buf[0] / 0x100000000; }
    : () => Math.random();
  // Fisher-Yates
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** Strip correct_index before sending to the client. */
export function sanitiseForClient(q: QuizPoolQuestion): { n: number; question: string; options: string[] } {
  return { n: q.n, question: q.question, options: q.options };
}

export function isLocked(lockedUntilIso: string | null | undefined): boolean {
  if (!lockedUntilIso) return false;
  return new Date(lockedUntilIso).getTime() > Date.now();
}

export function findInflightAttempt(history: AttemptHistoryEntry[]): AttemptHistoryEntry | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].submitted_at === null) return history[i];
  }
  return null;
}

/**
 * Score a submission against the served question set. Throws if any submitted
 * question_n is not in the served set (prevents the client from submitting
 * answers to questions other than the ones it was served).
 */
export function scoreSubmission(
  pool: QuizPoolQuestion[],
  servedNs: number[],
  answers: { question_n: number; selected_index: number }[],
): { score: number; total: number; missed: number[] } {
  const servedSet = new Set(servedNs);
  for (const a of answers) {
    if (!servedSet.has(a.question_n)) {
      throw new Error(`Submitted answer for unserved question ${a.question_n}`);
    }
  }
  const poolByN = new Map(pool.map(q => [q.n, q]));
  const answerByN = new Map(answers.map(a => [a.question_n, a.selected_index]));
  let score = 0;
  const missed: number[] = [];
  for (const n of servedNs) {
    const q = poolByN.get(n);
    if (!q) {
      missed.push(n);
      continue;
    }
    const selected = answerByN.get(n);
    if (selected !== undefined && selected === q.correct_index) {
      score++;
    } else {
      missed.push(n);
    }
  }
  return { score, total: servedNs.length, missed };
}
