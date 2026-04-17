import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { getUserLanguage, languageDirective } from '@/lib/ai/user-language';
import { getTemplate } from '@/lib/ai/document-templates';
import { getValidationRubric } from '@/lib/ai/interview-questions';

const anthropic = new Anthropic();

export interface DynamicFollowup {
  question: string;           // The contextual follow-up question to ask next
  rationale: string;          // Why this question matters (shown as subtle hint)
  type: 'clarify' | 'deepen' | 'missing' | 'priority';
}

/**
 * Per-doc-type guidance injected into the follow-up prompt. The thing a
 * follow-up should probe is very different for a thesis (methodology,
 * sample size) vs a business plan (unit economics, moat) vs a legal
 * contract (termination clauses, risk allocation). We surface the flavor
 * and the rubric's criteria names so Haiku asks the right kind of
 * next question.
 */
function buildFollowupGuidance(contentType?: string): {
  documentNoun: string;
  focusAreas: string;
  tone: string;
} {
  const template = getTemplate(contentType);
  const rubric = getValidationRubric(contentType);
  const criteriaList = rubric.criteria.map((c) => c.label.toLowerCase()).join(', ');

  switch (template.flavor) {
    case 'business':
      return {
        documentNoun: 'business plan / proposal / report',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups surface numbers the author glossed over, named customers / competitors, or the specific edge the author believes they have.`,
        tone: 'Crisp, analytical — like a VC partner in a 30-minute pitch meeting.',
      };
    case 'academic':
      return {
        documentNoun: 'academic paper / thesis',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups probe methodology specifics, sample size / data sources, prior literature the author should be in dialogue with, or how the original contribution will be defended.`,
        tone: 'Precise and collegial — like a thesis supervisor in office hours.',
      };
    case 'legal':
      return {
        documentNoun: 'legal document',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups surface jurisdiction-specific risks, missing protective clauses, edge cases (termination for convenience, IP assignment, liability caps), or commercial terms the author left vague.`,
        tone: 'Careful and practical — like an experienced commercial lawyer reviewing a first draft.',
      };
    case 'technical':
      return {
        documentNoun: 'technical document',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups dig into the reader's specific prerequisites, common failure modes to cover, version / platform assumptions, or the jobs-to-be-done the doc must enable.`,
        tone: 'Developer-to-developer — direct, concrete, assumes basic literacy.',
      };
    case 'reference':
      return {
        documentNoun: 'reference book (cookbook / guide)',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups surface the author's unique angle, repeat-use details (seasonal coverage, dietary flags, skill ramp), or what makes a reader reach for THIS book over competitors.`,
        tone: 'Warm and curious — like a cookbook editor in an early pitch meeting.',
      };
    case 'short_form':
      return {
        documentNoun: 'literary piece (poetry / short story)',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups push on craft — specific images, the emotional core, formal choices (line breaks, POV, structure), or what a reader should feel at the end.`,
        tone: 'Thoughtful and craft-focused — like a literary editor in a close-reading session.',
      };
    case 'narrative':
    case 'instructional':
    default:
      return {
        documentNoun: 'book',
        focusAreas: `Probe the areas a ${rubric.expertise} would press on: ${criteriaList}. Good follow-ups surface the author's unique lived experience, specific examples or case studies they'll draw from, the reader transformation they're aiming for, or the book's commercial positioning.`,
        tone: 'Conversational and curious — like an acquisitions editor on a first call.',
      };
  }
}

/**
 * Given the prior interview answers, pick the single highest-value next
 * question. Uses Haiku for speed and low cost — this runs after every major
 * answer. The prompt is adapted to the document type so a thesis interview
 * doesn't get book-marketing follow-ups and a contract interview doesn't
 * get story-arc follow-ups.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, chosenIdea, answers, contentType } = await request.json();

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

    // Fall back to the project's stored content_type when the client didn't
    // send one. We want to always have a flavor for the prompt.
    let resolvedContentType: string | undefined = contentType;
    if (!resolvedContentType && projectId) {
      const { data: proj } = await supabase
        .from('projects')
        .select('content_type')
        .eq('id', projectId)
        .single();
      resolvedContentType = proj?.content_type ?? undefined;
    }

    const guidance = buildFollowupGuidance(resolvedContentType);

    const answeredSummary = answers
      .filter((a: { question: string; answer: string }) => a.answer && a.answer.trim())
      .map((a: { question: string; answer: string }, i: number) => `Q${i + 1}: ${a.question}\nA: ${a.answer}`)
      .join('\n\n');

    const systemPrompt = langPrefix + `You are the interview agent for Penworth, helping an author plan a ${guidance.documentNoun} (document type: ${resolvedContentType || 'generic'}). Your job: pick the single highest-value follow-up question to ask based on the author's prior answers.

${guidance.focusAreas}

TONE: ${guidance.tone}

PICK ONE of four purposes:
1. CLARIFY — resolve an ambiguity in an answer
2. DEEPEN — push on something interesting that needs more detail
3. MISSING — surface a gap that will matter when writing the ${guidance.documentNoun}
4. PRIORITY — help author rank what matters most

RULES:
- Ask ONE specific question, not a broad prompt.
- Reference something the author actually said (quote a phrase if helpful).
- Don't repeat questions already answered.
- Keep it short and conversational, like you would speak it.
- Calibrate to the document type — never ask book-marketing questions of a thesis author or methodology questions of a cookbook author.
- If the prior answers are already thorough and there's no valuable follow-up, return null.

Respond ONLY with valid JSON matching exactly:
{
  "question": "<the specific question to ask next, or null if no follow-up needed>",
  "rationale": "<one sentence on why this question matters for the ${guidance.documentNoun}>",
  "type": "clarify" | "deepen" | "missing" | "priority"
}`;

    const userMessage = `CHOSEN IDEA / TOPIC: ${chosenIdea}

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
        metadata: { projectId, answerCount: answers.length, contentType: resolvedContentType },
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
