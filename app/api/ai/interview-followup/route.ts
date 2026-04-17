import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { getUserLanguage, languageDirective } from '@/lib/ai/user-language';

const anthropic = new Anthropic();

export interface DynamicFollowup {
  question: string;           // The contextual follow-up question to ask next
  rationale: string;          // Why this question matters (shown as subtle hint)
  type: 'clarify' | 'deepen' | 'missing' | 'priority';
}

/**
 * Given the prior interview answers, pick the single highest-value next question.
 * Uses Haiku for speed and low cost — this runs after every major answer.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, chosenIdea, answers } = await request.json();

    if (!projectId || !chosenIdea || !Array.isArray(answers)) {
      return NextResponse.json(
        { error: 'projectId, chosenIdea, and answers[] required' },
        { status: 400 }
      );
    }

    // If author has answered fewer than 2 questions, let the static interview
    // continue — there isn't enough signal to generate a useful follow-up.
    if (answers.length < 2) {
      return NextResponse.json({ followup: null });
    }

    const lang = await getUserLanguage(supabase, user.id);
    const langPrefix = languageDirective(lang);

    const answeredSummary = answers
      .filter((a: { question: string; answer: string }) => a.answer && a.answer.trim())
      .map((a: { question: string; answer: string }, i: number) => `Q${i + 1}: ${a.question}\nA: ${a.answer}`)
      .join('\n\n');

    const systemPrompt = langPrefix + `You are the interview agent for a book-writing platform. Your job: pick the single highest-value follow-up question to ask based on the author's prior answers.

PICK ONE of four purposes:
1. CLARIFY — resolve an ambiguity in an answer
2. DEEPEN — push on something interesting that needs more detail
3. MISSING — surface a gap that will matter when writing the book
4. PRIORITY — help author rank what matters most

RULES:
- Ask ONE specific question, not a broad prompt.
- Reference something the author actually said (quote a phrase if helpful).
- Don't repeat questions already answered.
- Keep it short and conversational, like you would speak it.
- If the prior answers are already thorough and there's no valuable follow-up, return null.

Respond ONLY with valid JSON matching exactly:
{
  "question": "<the specific question to ask next, or null if no follow-up needed>",
  "rationale": "<one sentence on why this question matters for the book>",
  "type": "clarify" | "deepen" | "missing" | "priority"
}`;

    const userMessage = `CHOSEN IDEA: ${chosenIdea}

AUTHOR'S ANSWERS SO FAR:
${answeredSummary}

Pick the single most valuable follow-up question now, or return {"question": null} if answers are already thorough enough.`;

    const response = await anthropic.messages.create({
      model: modelFor('interview_followup'),
      max_tokens: maxTokensFor('interview_followup'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: { question: string | null; rationale: string; type: string };
    try {
      parsed = JSON.parse(clean);
    } catch {
      return NextResponse.json({ followup: null });
    }

    // Log usage
    try {
      await supabase.from('usage').insert({
        user_id: user.id,
        action_type: 'interview_followup',
        tokens_input: response.usage.input_tokens,
        tokens_output: response.usage.output_tokens,
        model: modelFor('interview_followup'),
        cost_usd: calculateCost('interview_followup', response.usage.input_tokens, response.usage.output_tokens),
        metadata: { projectId, answerCount: answers.length },
      });
    } catch {
      // optional
    }

    if (!parsed.question) {
      return NextResponse.json({ followup: null });
    }

    const followup: DynamicFollowup = {
      question: parsed.question,
      rationale: parsed.rationale || '',
      type: (['clarify', 'deepen', 'missing', 'priority'].includes(parsed.type)
        ? parsed.type
        : 'deepen') as DynamicFollowup['type'],
    };

    return NextResponse.json({ followup });
  } catch (error) {
    console.error('Interview followup error:', error);
    // Never fail the interview flow — return no followup on error
    return NextResponse.json({ followup: null });
  }
}
