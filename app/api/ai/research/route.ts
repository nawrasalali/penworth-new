import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt } from '@/lib/ai/agent-brief';
import { getTemplate, CITATION_STYLES } from '@/lib/ai/document-templates';

const anthropic = new Anthropic();

/**
 * Research endpoint — flavor-aware.
 *
 * - General flavor (books, business, etc):
 *     Produces 5-8 qualified findings the author can verify. Marks speculative
 *     items "author_claim" / "moderate". Does not invent specific studies.
 *
 * - Academic flavor (research paper, thesis, dissertation):
 *     STRICT MODE. Every finding MUST include either a known seminal source,
 *     a peer-reviewed journal reference the author can retrieve, or an
 *     institutional/government data source. Findings without a retrievable
 *     source are flagged "needs_author_source" — the author must replace
 *     them during review. The model is explicitly forbidden from inventing
 *     DOIs, author names, page numbers, journal names, or publication years.
 *     Citations are emitted in the author's chosen style.
 */

interface GeneralFinding {
  title: string;
  summary: string;
  credibility: 'high' | 'moderate' | 'author_claim';
  relevance: string;
  type: 'market_data' | 'historical_context' | 'counterargument' | 'case_study' | 'statistic' | 'expert_perspective';
}

interface AcademicFinding {
  title: string;
  summary: string;            // 2-4 sentences of synthesis
  relevance: string;          // why this matters for the author's work
  source: {
    kind: 'seminal_work' | 'peer_reviewed' | 'institutional' | 'government' | 'preprint' | 'needs_author_source';
    authors?: string;         // "Smith, J. & Doe, A." — only if genuinely known
    year?: number | null;
    venue?: string;           // journal / book / organization
    title?: string;           // paper title if different from finding title
    url?: string;             // DOI link or stable URL
    doi?: string;
    confidence: 'verified' | 'likely_accurate' | 'placeholder_for_author';
  };
  citationStyleFormatted: string; // formatted string in the chosen style
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    const brief = await loadAgentBrief(supabase, projectId, user.id);
    const template = getTemplate(brief.contentType);
    const isAcademic = template.flavor === 'academic';

    const { data: session } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Interview session not found' }, { status: 404 });
    }

    // =====================================================================
    // ACADEMIC BRANCH — strict, citation-mandatory
    // =====================================================================
    if (isAcademic) {
      const styleId = brief.followUp.citationStyle;
      const style = CITATION_STYLES.find((s) => s.id === styleId);
      if (!styleId || !style) {
        return NextResponse.json(
          { error: 'Citation style required for academic research. Please complete the follow-up questions first (choose APA, Vancouver, MLA, Chicago, Harvard, or IEEE).' },
          { status: 400 },
        );
      }

      const academicSystem = `You are a SENIOR ACADEMIC RESEARCH AGENT producing a literature foundation for a research paper or thesis.

NON-NEGOTIABLE RULES:
1. Every finding you emit must be backed by one of:
   (a) A well-known seminal work you can identify with confidence (author, year, venue known)
   (b) A peer-reviewed journal or conference publication where you can name the journal/conference
   (c) An institutional or government data source (WHO, World Bank, OECD, national statistics office, etc.)
   (d) A recognised preprint server (arXiv, bioRxiv, SSRN, PubMed Central)
2. You MUST NOT FABRICATE sources. If you are not confident a DOI, author list, year, journal, or page number is real, you MUST mark that source as kind="needs_author_source" and set confidence="placeholder_for_author". In that case DO NOT emit a fake DOI or year; leave the field null and describe what the author should search for.
3. When you cite a source you are confident about, mark confidence="verified" (seminal works only) or "likely_accurate" (well-known findings you have seen in training but cannot 100% verify). Reserve "verified" for landmark works like Bandura's social learning theory or Kahneman & Tversky prospect theory — things where author + approximate year + venue are unambiguously correct.
4. Format citations in ${style.label} style (example format: ${style.example}).
5. No claim without a citation. No citation without evidence of a real source.
6. If the author's topic has few well-established primary sources, produce FEWER findings flagged as needs_author_source rather than filling the list with inventions.

Produce 6-10 findings covering:
- Foundational theoretical frameworks relevant to the topic
- Key empirical studies that establish the research gap
- Competing or critical perspectives
- Recent developments (last 5 years where possible)
- Methodological precedents the author might follow
- Data sources the author could reuse

Respond ONLY with valid JSON matching exactly:
{
  "findings": [
    {
      "title": "<descriptive finding title>",
      "summary": "<2-4 sentence synthesis of the finding>",
      "relevance": "<one sentence linking this to the author's research>",
      "source": {
        "kind": "seminal_work" | "peer_reviewed" | "institutional" | "government" | "preprint" | "needs_author_source",
        "authors": "<Surname, Initial. — or null if placeholder>",
        "year": <year as integer or null>,
        "venue": "<journal / publisher / organization — or null>",
        "title": "<source title — or null if same as finding title>",
        "url": "<DOI link or stable URL — or null>",
        "doi": "<DOI string — or null>",
        "confidence": "verified" | "likely_accurate" | "placeholder_for_author"
      },
      "citationStyleFormatted": "<citation formatted in ${style.label} style>"
    }
  ]
}`;

      const userMessage = `Produce an academic research foundation for the following work.

${formatBriefForPrompt(brief)}

The author has chosen ${style.label} citation style. Format the "citationStyleFormatted" field of each finding as a complete reference-list entry in that style.

Remember: NEVER invent a DOI, author, year, or journal. When unsure, mark source.kind="needs_author_source" and confidence="placeholder_for_author" with nulls for the uncertain fields, and describe in the summary what the author should search for (e.g., "Search PubMed for systematic reviews of X published 2020-2024").

Produce the findings now.`;

      const message = await anthropic.messages.create({
        model: modelFor('research_synthesis'),
        max_tokens: maxTokensFor('research_synthesis'),
        system: academicSystem,
        messages: [{ role: 'user', content: userMessage }],
      });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: { findings: AcademicFinding[] };
      try {
        parsed = JSON.parse(cleanJson);
      } catch (e) {
        console.error('Academic research parse error:', e, cleanJson.slice(0, 500));
        return NextResponse.json({ error: 'Failed to parse academic research response' }, { status: 500 });
      }

      if (!Array.isArray(parsed.findings) || parsed.findings.length === 0) {
        return NextResponse.json({ error: 'No findings generated' }, { status: 500 });
      }

      // Persist each finding — store the full source metadata so the writing
      // agent can produce properly formatted in-text citations and the final
      // References section.
      const rowsToInsert = parsed.findings.map((f) => ({
        session_id: session.id,
        resource_type: 'academic',
        title: f.title,
        url: f.source?.url || null,
        content_summary: [
          f.summary,
          `Relevance: ${f.relevance}`,
          `Source: ${f.source?.kind || 'unknown'} / confidence: ${f.source?.confidence || 'unknown'}`,
          `Citation (${style.label}): ${f.citationStyleFormatted}`,
          f.source?.kind === 'needs_author_source'
            ? '⚠️ AUTHOR ACTION REQUIRED: Replace with a verified source before publication.'
            : null,
        ].filter(Boolean).join('\n\n'),
        is_selected: true,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('research_resources')
        .insert(rowsToInsert)
        .select('id, resource_type, title, url, content_summary, is_selected');

      if (insertError) {
        console.error('Failed to persist academic research:', insertError);
        return NextResponse.json({ error: 'Failed to save research' }, { status: 500 });
      }

      // Log cost (best-effort)
      const cost = calculateCost('research_synthesis', message.usage.input_tokens, message.usage.output_tokens);
      try {
        await supabase.from('usage').insert({
          user_id: user.id,
          action_type: 'academic_research',
          tokens_input: message.usage.input_tokens,
          tokens_output: message.usage.output_tokens,
          model: modelFor('research_synthesis'),
          cost_usd: cost,
          metadata: { projectId, findingCount: parsed.findings.length, citationStyle: styleId },
        });
      } catch {
        // non-fatal
      }

      const needsAuthorSource = parsed.findings.filter((f) => f.source?.kind === 'needs_author_source').length;

      return NextResponse.json({
        flavor: 'academic',
        citationStyle: styleId,
        citationStyleLabel: style.label,
        findings: parsed.findings,
        resources: (inserted || []).map((r) => ({
          id: r.id,
          type: r.resource_type,
          title: r.title,
          summary: r.content_summary,
          url: r.url,
          isSelected: r.is_selected,
        })),
        needsAuthorSourceCount: needsAuthorSource,
        warning: needsAuthorSource > 0
          ? `${needsAuthorSource} finding(s) need you to supply a verified source before publication. Click each to review.`
          : null,
      });
    }

    // =====================================================================
    // GENERAL BRANCH — books, business, etc.
    // =====================================================================
    const systemPrompt = `You are a research agent for a publishing platform. Your job is to produce a focused research foundation that grounds the author's work in credible context — NOT to write the document.

You will output 5-8 research findings in JSON. Each finding must:
1. Be directly relevant to the chosen idea (not generic).
2. Make the work stronger by addressing a specific weakness or deepening a strength.
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
      "relevance": "<one sentence on why this matters for this specific work>",
      "type": "market_data" | "historical_context" | "counterargument" | "case_study" | "statistic" | "expert_perspective"
    }
  ]
}`;

    const userMessage = `Produce a research foundation for this project.

${formatBriefForPrompt(brief)}

Generate 5-8 research findings now. Focus on things that will make individual sections more credible and specific when they are written.`;

    const message = await anthropic.messages.create({
      model: modelFor('research_synthesis'),
      max_tokens: maxTokensFor('research_synthesis'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: { findings: GeneralFinding[] };
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json({ error: 'Failed to parse research response' }, { status: 500 });
    }

    if (!Array.isArray(parsed.findings) || parsed.findings.length === 0) {
      return NextResponse.json({ error: 'No findings generated' }, { status: 500 });
    }

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
      flavor: template.flavor,
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
