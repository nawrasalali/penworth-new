import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ValidationScore } from '@/types/agent-workflow';

const anthropic = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { topic, contentType } = await request.json();

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic is required' },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an expert publishing consultant and market analyst. Your job is to evaluate book ideas for their commercial viability and provide actionable feedback.

You will score ideas on these 6 criteria (each out of 10, totaling 100 points when weighted):
1. Market Demand (20%): Is there proven demand for this topic? Are people actively searching for and buying books like this?
2. Target Audience Clarity (15%): Is the intended reader clearly defined? Can you picture exactly who would buy this?
3. Unique Value Proposition (20%): What makes this different from existing books? Is there a fresh angle?
4. Author Credibility (15%): Does the author seem positioned to write this authoritatively? (Assume moderate credibility if unknown)
5. Commercial Viability (15%): Can this realistically sell? Is the price point viable? Is the market saturated?
6. Execution Feasibility (15%): Can this be written well? Is the scope manageable? Are there legal/ethical concerns?

SCORING GUIDE:
- 80-100: STRONG - Proceed with confidence
- 60-79: PROMISING - Good potential with refinements
- 40-59: RISKY - Significant concerns to address
- 0-39: RECONSIDER - Major issues, suggest alternatives

ALWAYS provide:
1. Individual scores for each criterion (out of 10)
2. Total weighted score (out of 100)
3. A verdict (STRONG/PROMISING/RISKY/RECONSIDER)
4. A 2-3 sentence summary
5. 2-3 key strengths
6. 2-3 critical weaknesses
7. If score < 70, suggest 1-2 alternative topics that would score higher

Respond ONLY with valid JSON matching this exact structure:
{
  "total": <number 0-100>,
  "breakdown": {
    "marketDemand": <number 0-10>,
    "targetAudience": <number 0-10>,
    "uniqueValue": <number 0-10>,
    "authorCredibility": <number 0-10>,
    "commercialViability": <number 0-10>,
    "executionFeasibility": <number 0-10>
  },
  "verdict": "<STRONG|PROMISING|RISKY|RECONSIDER>",
  "summary": "<2-3 sentence summary>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "alternatives": [
    {
      "title": "<alternative topic title>",
      "estimatedScore": <number>,
      "reason": "<why this would score higher>"
    }
  ]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Please evaluate this book idea:

TOPIC/IDEA: ${topic}
CONTENT TYPE: ${contentType || 'book'}

Analyze this idea thoroughly and provide your scoring assessment.`
        }
      ]
    });

    const responseText = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    // Parse the JSON response
    let score: ValidationScore;
    try {
      // Clean up the response in case it has markdown code blocks
      const cleanJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      score = JSON.parse(cleanJson);
      
      // Calculate weighted total if not provided correctly
      const weighted = 
        (score.breakdown.marketDemand * 2) +      // 20%
        (score.breakdown.targetAudience * 1.5) +   // 15%
        (score.breakdown.uniqueValue * 2) +        // 20%
        (score.breakdown.authorCredibility * 1.5) + // 15%
        (score.breakdown.commercialViability * 1.5) + // 15%
        (score.breakdown.executionFeasibility * 1.5);  // 15%
      
      score.total = Math.round(weighted);
      
      // Ensure verdict matches score
      if (score.total >= 80) score.verdict = 'STRONG';
      else if (score.total >= 60) score.verdict = 'PROMISING';
      else if (score.total >= 40) score.verdict = 'RISKY';
      else score.verdict = 'RECONSIDER';
      
    } catch (parseError) {
      console.error('Failed to parse validation response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse validation response' },
        { status: 500 }
      );
    }

    return NextResponse.json({ score });

  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate topic' },
      { status: 500 }
    );
  }
}
