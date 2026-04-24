import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ValidationScore } from '@/types/agent-workflow';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import { createClient } from '@/lib/supabase/server';
import { getUserLanguage, languageDirective } from '@/lib/ai/user-language';
import { getValidationRubric } from '@/lib/ai/interview-questions';

export const maxDuration = 300;

const anthropic = new Anthropic();

/**
 * POST /api/ai/validate
 * body: { topic: string, contentType: string }
 *
 * Scores a user's idea using a document-type-specific rubric. A business
 * plan is never judged against book-trade criteria; a legal contract isn't
 * scored for 'market demand'. The rubric per contentType lives in
 * lib/ai/interview-questions.ts so all doc-type behaviour is colocated.
 */
export async function POST(request: NextRequest) {
  try {
    const { topic, contentType } = await request.json();

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const lang = user ? await getUserLanguage(supabase, user.id) : 'en';
    const langPrefix = languageDirective(lang);

    const rubric = getValidationRubric(contentType);

    const rubricLines = rubric.criteria
      .map((c, i) => `${i + 1}. ${c.label} (${Math.round(c.weight * 100)}%): ${c.description}`)
      .join('\n');

    const breakdownShape = rubric.criteria
      .map((c) => `    "${c.key}": <number 0-10>`)
      .join(',\n');

    const systemPrompt = `${langPrefix}You are a ${rubric.expertise}. Your job is to evaluate ideas for the specific document type the author is writing (contentType: ${contentType || 'generic'}).

You score ideas on these six weighted criteria (each 0-10, weighted to total 100):
${rubricLines}

SCORING BANDS:
- 80-100: STRONG — Proceed with confidence
- 60-79: PROMISING — Good potential with refinements
- 40-59: RISKY — Significant concerns to address
- 0-39: RECONSIDER — Major issues; suggest alternatives

Always provide:
1. Individual scores for each criterion (0-10)
2. A weighted total (0-100) — we'll recompute server-side, but include your best estimate
3. A verdict: STRONG / PROMISING / RISKY / RECONSIDER
4. A 2-3 sentence summary written for this specific document type
5. 2-3 genuine strengths of the idea
6. 2-3 specific weaknesses the author should address
7. If the total is below 70, suggest 1-2 alternative framings that would likely score higher — still appropriate for the same document type

Never score below 30 on anything without a specific, actionable reason. Never praise vaguely.

Respond with valid JSON only (no markdown, no code fences), matching exactly:
{
  "total": <number 0-100>,
  "breakdown": {
${breakdownShape}
  },
  "verdict": "<STRONG|PROMISING|RISKY|RECONSIDER>",
  "summary": "<2-3 sentence summary>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "alternatives": [
    { "title": "<alternative>", "estimatedScore": <number>, "reason": "<why this would score higher>" }
  ]
}`;

    const message = await anthropic.messages.create({
      model: modelFor('validate_idea'),
      max_tokens: maxTokensFor('validate_idea'),
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `DOCUMENT TYPE: ${contentType || 'generic'}\n\nIDEA TO EVALUATE:\n${topic}\n\nScore this idea against the rubric above. Be honest; surface real concerns the author needs to address.`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    let score: ValidationScore;
    try {
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      const breakdown = parsed.breakdown || {};

      // Map the dynamic rubric keys to the six-slot breakdown ValidationScore
      // expects. For non-narrative rubrics this picks the closest analog so
      // the existing pie chart still renders correctly.
      const legacyBreakdown = {
        marketDemand:
          breakdown.marketDemand ?? breakdown.marketSize ?? breakdown.audienceFit ??
          breakdown.audienceClarity ?? breakdown.novelty ?? breakdown.scopeClarity ??
          breakdown.originality ?? 5,
        targetAudience:
          breakdown.targetAudience ?? breakdown.audienceClarity ?? breakdown.audienceFit ??
          breakdown.publicationFit ?? 5,
        uniqueValue:
          breakdown.uniqueValue ?? breakdown.differentiation ?? breakdown.uniqueAngle ??
          breakdown.novelty ?? 5,
        authorCredibility:
          breakdown.authorCredibility ?? breakdown.teamFit ?? breakdown.authorAuthority ??
          breakdown.methodological ?? breakdown.technicalAccuracy ?? 5,
        commercialViability:
          breakdown.commercialViability ?? breakdown.unitEconomics ?? breakdown.priceJustification ??
          breakdown.repeatUse ?? breakdown.enforceability ?? breakdown.craftPotential ?? 5,
        executionFeasibility:
          breakdown.executionFeasibility ?? breakdown.executionPath ?? breakdown.feasibility ??
          breakdown.scope ?? breakdown.maintainability ?? breakdown.emotionalCore ?? 5,
      };

      const weighted =
        legacyBreakdown.marketDemand * 2 +
        legacyBreakdown.targetAudience * 1.5 +
        legacyBreakdown.uniqueValue * 2 +
        legacyBreakdown.authorCredibility * 1.5 +
        legacyBreakdown.commercialViability * 1.5 +
        legacyBreakdown.executionFeasibility * 1.5;

      score = {
        ...parsed,
        breakdown: legacyBreakdown,
        total: Math.round(weighted),
      } as ValidationScore;

      if (score.total >= 80) score.verdict = 'STRONG';
      else if (score.total >= 60) score.verdict = 'PROMISING';
      else if (score.total >= 40) score.verdict = 'RISKY';
      else score.verdict = 'RECONSIDER';
    } catch (parseError) {
      console.error('Failed to parse validation response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse validation response' },
        { status: 500 },
      );
    }

    return NextResponse.json({ score, rubric });
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json({ error: 'Failed to validate topic' }, { status: 500 });
  }
}
