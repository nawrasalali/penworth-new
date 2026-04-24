import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ValidationScore } from '@/types/agent-workflow';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import { createClient } from '@/lib/supabase/server';
import { getUserLanguage, languageDirective } from '@/lib/ai/user-language';

export const maxDuration = 300;

const anthropic = new Anthropic();

interface ProposedIdea {
  title: string;                    // New, stronger title
  positioning: string;              // One-sentence hook
  targetAudience: string;           // Who exactly buys this
  uniqueAngle: string;              // What makes this different
  whyStronger: string[];            // 3-5 bullets on why it beats the original
  addressedWeaknesses: string[];    // Mapping from original weaknesses to fixes
  estimatedScore: ValidationScore;  // Full re-scored breakdown
}

export async function POST(request: NextRequest) {
  try {
    const { originalTopic, contentType, currentScore } = await request.json();

    if (!originalTopic || !currentScore) {
      return NextResponse.json(
        { error: 'originalTopic and currentScore are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const lang = user ? await getUserLanguage(supabase, user.id) : 'en';
    const langPrefix = languageDirective(lang);

    const systemPrompt = langPrefix + `You are a senior publishing strategist. An author has submitted an idea that scored ${currentScore.total}/100 in market evaluation. Your job is to propose ONE significantly stronger version of the same idea — not a different idea entirely, but the SAME core concept reframed to address its specific weaknesses and maximize market viability.

RULES:
1. Preserve the author's core intent and domain expertise — do not redirect them to an unrelated topic.
2. Address EVERY weakness identified in the current score.
3. Sharpen the unique angle: what does this book say that no other book says?
4. Make the target audience painfully specific (not "business owners" but "SaaS founders in their first fundraising round").
5. The proposed idea must plausibly score 85+/100 — if it can't, be honest about a realistic ceiling.
6. Preserve the content type (${contentType || 'book'}).

Respond ONLY with valid JSON matching this exact structure:
{
  "title": "<stronger title or reframed topic>",
  "positioning": "<one-sentence positioning hook>",
  "targetAudience": "<painfully specific audience description>",
  "uniqueAngle": "<what makes this unlike every other book in the space>",
  "whyStronger": ["<reason 1>", "<reason 2>", "<reason 3>"],
  "addressedWeaknesses": ["<original weakness 1 → fix>", "<original weakness 2 → fix>"],
  "estimatedScore": {
    "total": <number, realistic 75-95>,
    "breakdown": {
      "marketDemand": <number 0-10>,
      "targetAudience": <number 0-10>,
      "uniqueValue": <number 0-10>,
      "authorCredibility": <number 0-10>,
      "commercialViability": <number 0-10>,
      "executionFeasibility": <number 0-10>
    },
    "verdict": "<STRONG|PROMISING|RISKY|RECONSIDER>",
    "summary": "<2-3 sentence summary of the stronger idea>",
    "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
    "weaknesses": ["<any remaining weakness>"]
  }
}`;

    const weaknessList = (currentScore.weaknesses || []).map((w: string, i: number) => `${i + 1}. ${w}`).join('\n');
    const strengthList = (currentScore.strengths || []).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');

    const userMessage = `ORIGINAL IDEA: ${originalTopic}
CONTENT TYPE: ${contentType || 'book'}
CURRENT SCORE: ${currentScore.total}/100 (${currentScore.verdict})

IDENTIFIED STRENGTHS (preserve these):
${strengthList || '(none noted)'}

IDENTIFIED WEAKNESSES (fix every one):
${weaknessList || '(none noted)'}

CURRENT BREAKDOWN:
- Market Demand: ${currentScore.breakdown.marketDemand}/10
- Target Audience: ${currentScore.breakdown.targetAudience}/10
- Unique Value: ${currentScore.breakdown.uniqueValue}/10
- Author Credibility: ${currentScore.breakdown.authorCredibility}/10
- Commercial Viability: ${currentScore.breakdown.commercialViability}/10
- Execution Feasibility: ${currentScore.breakdown.executionFeasibility}/10

Propose one stronger version of this same core idea.`;

    const message = await anthropic.messages.create({
      model: modelFor('propose_stronger_idea'),
      max_tokens: maxTokensFor('propose_stronger_idea'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    let proposal: ProposedIdea;
    try {
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      proposal = JSON.parse(cleanJson);

      // Recalculate total score from breakdown to guarantee correctness
      const b = proposal.estimatedScore.breakdown;
      const weighted =
        b.marketDemand * 2 +
        b.targetAudience * 1.5 +
        b.uniqueValue * 2 +
        b.authorCredibility * 1.5 +
        b.commercialViability * 1.5 +
        b.executionFeasibility * 1.5;
      proposal.estimatedScore.total = Math.round(weighted);

      if (proposal.estimatedScore.total >= 80) proposal.estimatedScore.verdict = 'STRONG';
      else if (proposal.estimatedScore.total >= 60) proposal.estimatedScore.verdict = 'PROMISING';
      else if (proposal.estimatedScore.total >= 40) proposal.estimatedScore.verdict = 'RISKY';
      else proposal.estimatedScore.verdict = 'RECONSIDER';
    } catch (parseError) {
      console.error('Failed to parse proposal response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse proposal response' },
        { status: 500 }
      );
    }

    return NextResponse.json({ proposal });
  } catch (error) {
    console.error('Propose stronger idea error:', error);
    return NextResponse.json({ error: 'Failed to propose stronger idea' }, { status: 500 });
  }
}
