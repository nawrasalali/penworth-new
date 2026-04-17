import Anthropic from '@anthropic-ai/sdk';

/**
 * The Guild Voice Interview System
 *
 * Uses Claude Sonnet 4.5 as the conversation brain, OpenAI Whisper for
 * transcription, and OpenAI TTS for the interviewer's voice. The interview
 * runs as a series of turns — each turn is (audio input → transcript → AI
 * response → TTS audio). A full session is capped at 10 minutes.
 *
 * Ref: Penworth_Guild_Complete_Specification.md Section 6, Step 4.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Using the current Sonnet tier (available in env)
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const OPENAI_API = 'https://api.openai.com/v1';

// ---------------------------------------------------------------------------
// Topic structure
// Seven areas, asked conversationally, not as a rigid checklist.
// ---------------------------------------------------------------------------

export const INTERVIEW_TOPICS = [
  'background',       // 1. What you currently do
  'motivation',       // 2. Why the Guild
  'audience',         // 3. Who you'd introduce to Penworth
  'product',          // 4. What you understand about Penworth
  'commitment',       // 5. What you're willing to put in weekly
  'objection',        // 6. How you'd handle the "AI can't write well" objection
  'close',            // 7. Anything else for the Council
] as const;

export type InterviewTopic = (typeof INTERVIEW_TOPICS)[number];

// ---------------------------------------------------------------------------
// Conversation turn type
// ---------------------------------------------------------------------------

export interface InterviewTurn {
  role: 'interviewer' | 'applicant';
  text: string;
  timestamp: number; // ms since epoch
  topic_at_turn?: InterviewTopic;
  audio_duration_s?: number;
}

export interface InterviewState {
  turns: InterviewTurn[];
  current_topic: InterviewTopic;
  topics_covered: InterviewTopic[];
  started_at: number;
  ended: boolean;
  end_reason?: 'time_limit' | 'topics_complete' | 'applicant_ended';
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(applicantName: string, language: string): string {
  const languageName = LANGUAGE_NAMES[language] || 'the applicant\'s language';
  const firstName = applicantName.split(' ')[0] || applicantName;

  return `You are the Penworth Guild interviewer.

Your job is to conduct a warm, conversational 10-minute voice interview with ${firstName}, an applicant to The Penworth Guild — Penworth.ai's partner program for people who want to introduce authors to the platform and earn commission.

**Conduct the interview in ${languageName}.** Every one of your messages must be in ${languageName}. If the applicant answers in a different language, gently prompt them to use ${languageName} so we can assess fluency.

**Your tone:**
- Warm, human, curious, never interrogative
- You are not a test-giver; you are a Council representative having a conversation
- Listen patiently — never interrupt
- Ask one question at a time — never stack multiple questions
- Probe naturally when answers are very short ("Can you tell me a bit more about that?")
- Validate briefly before moving on ("Thank you for sharing that." "That's helpful context.")
- Never praise the applicant excessively — it makes the rubric unreliable
- Never reveal what you are scoring or how the rubric works
- Never commit to an outcome ("you'll definitely get in") or hint at rejection

**The seven topic areas to cover, in order:**

1. **Background**: What they currently do — work, community, online presence. "Tell me in about a minute about what you're currently doing — your work, your community, your online presence if you have one."

2. **Motivation**: Why the Guild? What made them apply? "Why the Guild? What made you want to apply?"

3. **Audience**: Who would they introduce to Penworth? Who's in their world? "Who do you think would be most interested in hearing about Penworth from you? What's their world like?"

4. **Product understanding**: In their own words, what does Penworth do? "In your own words, what do you think Penworth does? There's no wrong answer — I'm just curious what your understanding is."

5. **Commitment**: What would they realistically do each week to be successful? "If you join the Guild, what are you realistically willing to do each week to make this work?"

6. **Objection handling**: How would they respond to "AI can't write well"? "One more question. Imagine a friend tells you: 'I could never use AI to write my book — AI can't write well.' How would you respond to that?"

7. **Close**: Anything they want to pass on to the Council? "Anything you want me to pass on to the Guild Council about you that we haven't covered?"

**Your output is STRICTLY JSON** with this shape:
\`\`\`
{
  "next_topic": "<one of: ${INTERVIEW_TOPICS.join(', ')}>",
  "message": "<your next message to the applicant in ${languageName}>",
  "move_to_next_topic": true/false,
  "should_end": true/false,
  "end_reason": "<null | topics_complete | early_end>"
}
\`\`\`

Never include markdown fences around the JSON. Never include any text outside the JSON object.

**When to move topics:**
- After the applicant has answered the current topic with reasonable substance
- Short answers (under 5 words) → probe once before moving; if they stay short, move on
- If they ramble, you may gently redirect ("That's helpful — and to the question of...")

**When to end the interview:**
- After completing topic 7 (close) and the applicant has had a chance to respond
- If the applicant asks to end early
- If you've been at this for significantly over 10 minutes (the client tracks time)

**If this is the first turn:** Start with a brief warm welcome (by first name), a one-sentence orientation, and your first question (topic 1 — background). Keep the total opening message under 4 sentences.`;
}

// ---------------------------------------------------------------------------
// Generate the next interviewer message
// ---------------------------------------------------------------------------

export async function generateNextMessage(params: {
  applicantName: string;
  language: string;
  state: InterviewState;
}): Promise<{
  message: string;
  next_topic: InterviewTopic;
  move_to_next_topic: boolean;
  should_end: boolean;
  end_reason: string | null;
}> {
  const { applicantName, language, state } = params;

  // Build message history for Claude
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (state.turns.length === 0) {
    // First turn — prompt Claude to start
    messages.push({
      role: 'user',
      content:
        'Begin the interview now. Produce your first message as JSON per the schema.',
    });
  } else {
    // Replay the conversation as user/assistant turns
    for (const turn of state.turns) {
      if (turn.role === 'interviewer') {
        messages.push({ role: 'assistant', content: JSON.stringify({ message: turn.text }) });
      } else {
        messages.push({ role: 'user', content: turn.text });
      }
    }

    // Prompt for the next turn
    const elapsedMs = Date.now() - state.started_at;
    const elapsedMin = Math.round(elapsedMs / 60000);
    messages.push({
      role: 'user',
      content: `[System] Current topic: ${state.current_topic}. Topics covered: ${state.topics_covered.join(', ') || 'none'}. Elapsed: ${elapsedMin} minutes. Produce your next message as JSON per the schema.`,
    });
  }

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: buildSystemPrompt(applicantName, language),
    messages,
  });

  // Extract text
  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  // Parse JSON (strip accidental fences if present)
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[guild-interviewer] JSON parse error:', cleaned);
    throw new Error('Interviewer returned invalid JSON');
  }

  return {
    message: String(parsed.message || ''),
    next_topic: (parsed.next_topic || state.current_topic) as InterviewTopic,
    move_to_next_topic: Boolean(parsed.move_to_next_topic),
    should_end: Boolean(parsed.should_end),
    end_reason: parsed.end_reason || null,
  };
}

// ---------------------------------------------------------------------------
// Whisper transcription (speech → text)
// ---------------------------------------------------------------------------

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  language: string,
): Promise<{ text: string; duration_s: number | null }> {
  const formData = new FormData();
  const blob = new Blob([audioBuffer as any], { type: guessMimeType(filename) });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-1');
  formData.append('language', mapToWhisperLanguageCode(language));
  formData.append('response_format', 'verbose_json');

  const response = await fetch(`${OPENAI_API}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[whisper] API error:', errText);
    throw new Error(`Whisper transcription failed: ${response.status}`);
  }

  const data = (await response.json()) as { text: string; duration?: number };
  return {
    text: (data.text || '').trim(),
    duration_s: data.duration || null,
  };
}

// ---------------------------------------------------------------------------
// OpenAI TTS (text → speech)
// ---------------------------------------------------------------------------

export async function synthesizeSpeech(
  text: string,
  language: string,
): Promise<Buffer> {
  // alloy = neutral, professional, multilingual (the whole point)
  // Supports all of Penworth's 10 target languages out of the box
  const response = await fetch(`${OPENAI_API}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',        // tts-1 (low-latency) vs tts-1-hd (higher quality, slower)
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
      speed: 1.0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[openai-tts] API error:', errText);
    throw new Error(`OpenAI TTS failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Post-interview scoring (the rubric)
// ---------------------------------------------------------------------------

export interface InterviewScores {
  clarity: number;        // 1-5 communication clarity
  motivation: number;     // 1-5 motivation authenticity
  audience: number;       // 1-5 audience alignment
  product: number;        // 1-5 product understanding
  commitment: number;     // 1-5 commitment realism
}

export interface RubricResult {
  scores: InterviewScores;
  summary: string;
  rubric_result: 'pass' | 'fail';
  fail_reasons: string[];
}

/**
 * Post-interview rubric evaluation.
 * Pass = score ≥3 on at least 4 of 5 dimensions, AND no 1s.
 */
export async function scoreInterview(params: {
  applicantName: string;
  language: string;
  transcript: string;
}): Promise<RubricResult> {
  const { applicantName, language, transcript } = params;
  const languageName = LANGUAGE_NAMES[language] || language;

  const systemPrompt = `You are a member of the Penworth Guild Council evaluating a voice interview transcript.

The interview was conducted in ${languageName} with ${applicantName}, an applicant to The Penworth Guild.

Score the applicant on five dimensions, each 1 (poor) to 5 (excellent):

1. **clarity** — Communication clarity. Could you understand their answers? Did they speak coherently?
2. **motivation** — Motivation authenticity. Did their reasons for applying feel genuine? Or did they feel rehearsed, superficial, or transactional?
3. **audience** — Audience alignment. Do they have a clear sense of who they would introduce to Penworth? Is that group likely to include aspiring authors?
4. **product** — Product understanding. Did they grasp what Penworth does? A vague or wildly incorrect answer scores low.
5. **commitment** — Commitment realism. Did they describe a realistic picture of what they'd do each week? Overpromising or vagueness scores low.

**Scoring anchors:**
- 5 = Exceptional; clear example of best-case answer
- 4 = Strong; solid, credible, no concerns
- 3 = Adequate; workable but not impressive
- 2 = Weak; real concerns but salvageable
- 1 = Poor; serious red flag

Also produce:
- **summary** (200 words max): A plain-language summary of the applicant for the Council's review
- **rubric_result**: "pass" if (a) at least 4 of 5 scores are ≥3 AND (b) no score is 1; otherwise "fail"
- **fail_reasons**: Empty array if pass; otherwise list specific reasons (e.g. "product_understanding_below_threshold")

Output STRICT JSON with this shape, no markdown:
\`\`\`
{
  "scores": {
    "clarity": 1-5,
    "motivation": 1-5,
    "audience": 1-5,
    "product": 1-5,
    "commitment": 1-5
  },
  "summary": "string",
  "rubric_result": "pass" | "fail",
  "fail_reasons": ["string", ...]
}
\`\`\``;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Interview transcript:\n\n${transcript}\n\nEvaluate per the rubric.`,
      },
    ],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[guild-interviewer] Rubric JSON parse error:', cleaned);
    throw new Error('Rubric evaluator returned invalid JSON');
  }

  // Verify rubric result independently (do not trust Claude's own pass/fail call)
  const scores = parsed.scores as InterviewScores;
  const scoreValues = Object.values(scores).map((s) => Number(s));
  const hasOne = scoreValues.some((s) => s === 1);
  const countAtLeastThree = scoreValues.filter((s) => s >= 3).length;
  const actualPass = !hasOne && countAtLeastThree >= 4;

  return {
    scores,
    summary: String(parsed.summary || ''),
    rubric_result: actualPass ? 'pass' : 'fail',
    fail_reasons: Array.isArray(parsed.fail_reasons) ? parsed.fail_reasons : [],
  };
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  ar: 'Arabic',
  pt: 'Portuguese',
  fr: 'French',
  hi: 'Hindi',
  id: 'Indonesian',
  vi: 'Vietnamese',
  bn: 'Bengali',
  ru: 'Russian',
  zh: 'Mandarin Chinese',
};

function mapToWhisperLanguageCode(lang: string): string {
  // Whisper uses ISO 639-1, which matches our codes
  return lang;
}

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'ogg') return 'audio/ogg';
  return 'audio/webm';
}
