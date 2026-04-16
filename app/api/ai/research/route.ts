import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt } from '@/lib/ai/agent-brief';

const anthropic = new Anthropic();

interface ResearchFinding {
  title: string;
  summary: string;       // 2-3 sentences explaining the finding
  credibility: 'high' | 'moderate' | 'author_claim';
  relevance: string;     // Why this matters for the chosen idea
  type: 'market_data' | 'historical_context' | 'counterargument' | 'case_study' | 'statistic' | 'expert_perspective';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    // Load context from validate + interview stages
    const brief = await loadAgentBrief(supabase, projectId, user.id);

    // Fetch session id so we can persist findings
    const { data: session } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Interview session not found' }, { status: 404 });
    }

    const systemPrompt = `You are a research agent for a publishing platform. Your job is to produce a focused research foundation that grounds the author's book in credible context — NOT to write the book.

You will output 5-8 research findings in JSON. Each finding must:
1. Be directly relevant to the chosen idea (not generic).
2. Make the book stronger by addressing a specific weakness or deepening a strength.
3. Include a credibility tag so the author knows how much to lean on it.
4. Cover a mix: market data, historical context, counterarguments, case studies, statistics, expert perspectives.

DO NOT invent specific statistics, studies, or names of real people. When you reference data, describe it in qualified terms ("industry reports suggest", "commonly cited estimate is") so the author can later verify. Mark these as "moderate" or "author_claim" credibility.

Respond ONLY with valid JSON matching exactly:
{
  "findings": [
    {
      "title": "<short title (5-10 words)>",
      "summary": "<2-3 sentence explanation>",
      "credibility": "high" | "moderate" | "author_claim",
      "relevance": "<one sentence on why this matters for this specific book>",
      "type": "market_data" | "historical_context" | "counterargument" | "case_study" | "statistic" | "expert_perspective"
    }
  ]
}`;

    const userMessage = `Produce a research foundation for this book project.

${formatBriefForPrompt(brief)}

Generate 5-8 research findings now. Focus on things that will make individual chapters more credible and specific when they are written.`;

    const message = await anthropic.messages.create({
      model: modelFor('research_synthesis'),
      max_tokens: maxTokensFor('research_synthesis'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: { findings: ResearchFinding[] };
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json({ error: 'Failed to parse research response' }, { status: 500 });
    }

    if (!Array.isArray(parsed.findings) || parsed.findings.length === 0) {
      return NextResponse.json({ error: 'No findings generated' }, { status: 500 });
    }

    // Persist findings as research_resources rows (all selected by default)
    const rowsToInsert = parsed.findings.map((f) => ({
      session_id: session.id,
      resource_type: 'generated',
      title: f.title,
      content_summary: `${f.summary}\n\nRelevance: ${f.relevance}\nCredibility: ${f.credibility}\nType: ${f.type}`,
      is_selected: true,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('research_resources')
      .insert(rowsToInsert)
      .select('id, resource_type, title, content_summary, is_selected');

    if (insertError) {
      console.error('Failed to persist research findings:', insertError);
      return NextResponse.json({ error: 'Failed to save research' }, { status: 500 });
    }

    // Log usage for cost tracking (best-effort; usage table may not exist yet)
    const cost = calculateCost('research_synthesis', message.usage.input_tokens, message.usage.output_tokens);
    try {
      await supabase.from('usage').insert({
        user_id: user.id,
        action_type: 'research_synthesis',
        tokens_input: message.usage.input_tokens,
        tokens_output: message.usage.output_tokens,
        model: modelFor('research_synthesis'),
        cost_usd: cost,
        metadata: { projectId, findingCount: parsed.findings.length },
      });
    } catch {
      // usage table may not exist yet — non-fatal
    }

    return NextResponse.json({
      findings: parsed.findings,
      resources: (inserted || []).map((r) => ({
        id: r.id,
        type: r.resource_type,
        title: r.title,
        summary: r.content_summary,
        isSelected: r.is_selected,
      })),
    });
  } catch (error) {
    console.error('Research error:', error);
    const msg = error instanceof Error ? error.message : 'Research failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
