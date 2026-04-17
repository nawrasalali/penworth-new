import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt, resolveChapterCount } from '@/lib/ai/agent-brief';
import {
  getTemplate,
  type DocumentTemplate,
  type DocumentSection,
  CITATION_STYLES,
} from '@/lib/ai/document-templates';

const anthropic = new Anthropic();

/**
 * Outline endpoint — document-type aware.
 *
 * For narrative books (fiction, non-fiction, memoir): asks the AI to produce
 * N variable chapters with key points.
 *
 * For fixed-structure documents (research papers, business plans, contracts):
 * emits EXACTLY the template's fixedBody sections. The AI only fills in
 * titles, descriptions, and keyPoints tailored to the author's brief — it
 * cannot add or remove sections.
 *
 * Output shape preserves legacy `chapters` alias for backwards compatibility,
 * but the authoritative field is `body` (front -> body -> back).
 */

interface BodySection {
  number: number;
  key: string;
  title: string;
  description: string;
  keyPoints: string[];
  estimatedWords: number;
}

interface OutlineSectionOut {
  id: string;
  type: 'front_matter' | 'chapter' | 'back_matter';
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  status: 'complete';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId, feedback } = await request.json();
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    const brief = await loadAgentBrief(supabase, projectId, user.id);
    const template = getTemplate(brief.contentType);
    const task = feedback ? 'outline_refine' : 'outline_generate';

    let parsed: {
      frontMatter: Array<{ title: string; description: string; key?: string; keyPoints?: string[]; estimatedWords?: number }>;
      body: BodySection[];
      backMatter: Array<{ title: string; description: string; key?: string; keyPoints?: string[]; estimatedWords?: number }>;
    };

    if (template.bodyIsVariable) {
      parsed = await generateVariableOutline(brief, template, feedback, task);
    } else {
      parsed = await generateFixedOutline(brief, template, feedback, task);
    }

    if (!Array.isArray(parsed.body) || parsed.body.length === 0) {
      return NextResponse.json({ error: 'Outline produced no body sections' }, { status: 500 });
    }

    // Flatten into OutlineSection[] for the UI.
    const bodyLabel = template.bodyLabelSingular;
    const sections: OutlineSectionOut[] = [
      ...parsed.frontMatter.map((fm, i) => ({
        id: `fm-${i}`,
        type: 'front_matter' as const,
        title: fm.title,
        description: fm.description,
        keyPoints: fm.keyPoints,
        estimatedWords: fm.estimatedWords,
        status: 'complete' as const,
      })),
      ...parsed.body.map((b) => ({
        id: `body-${b.number}`,
        type: 'chapter' as const,
        title: b.title.startsWith(bodyLabel) || /^\d+\./.test(b.title)
          ? b.title
          : `${bodyLabel} ${b.number}: ${b.title}`,
        description: b.description,
        keyPoints: b.keyPoints,
        estimatedWords: b.estimatedWords,
        status: 'complete' as const,
      })),
      ...parsed.backMatter.map((bm, i) => ({
        id: `bm-${i}`,
        type: 'back_matter' as const,
        title: bm.title,
        description: bm.description,
        keyPoints: bm.keyPoints,
        estimatedWords: bm.estimatedWords,
        status: 'complete' as const,
      })),
    ];

    // Persist into interview_sessions.outline_data with template metadata so
    // the writing pipeline can honor it without re-reading the registry.
    const { data: sessionRow } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (sessionRow) {
      await supabase
        .from('interview_sessions')
        .update({
          outline_data: {
            sections,
            body: parsed.body,
            // Legacy alias: keep `chapters` populated so older readers don't break
            chapters: parsed.body.map((b) => ({
              number: b.number,
              title: b.title,
              description: b.description,
              keyPoints: b.keyPoints,
              estimatedWords: b.estimatedWords,
            })),
            frontMatter: parsed.frontMatter,
            backMatter: parsed.backMatter,
            templateMeta: {
              flavor: template.flavor,
              bodyLabelSingular: template.bodyLabelSingular,
              bodyLabelPlural: template.bodyLabelPlural,
              bodyIsVariable: template.bodyIsVariable,
              requiresCitations: template.requiresCitations,
              writingStyleGuide: template.writingStyleGuide,
              citationStyle: brief.followUp.citationStyle,
            },
            generatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionRow.id);
    }

    return NextResponse.json({
      sections,
      body: parsed.body,
      chapters: parsed.body,
      frontMatter: parsed.frontMatter,
      backMatter: parsed.backMatter,
      flavor: template.flavor,
      requiresCitations: template.requiresCitations,
    });
  } catch (error) {
    console.error('Outline error:', error);
    const msg = error instanceof Error ? error.message : 'Outline generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================================
// VARIABLE BODY (books, cookbooks, technical docs)
// ============================================================================

async function generateVariableOutline(
  brief: any,
  template: DocumentTemplate,
  feedback: string | undefined,
  task: 'outline_generate' | 'outline_refine',
) {
  const bodyCount = resolveChapterCount(brief.followUp.chapters, 10);
  const targetPerSection = Math.round((template.bodyMinWords + template.bodyMaxWords) / 2);
  const bodyLabel = template.bodyLabelSingular;
  const bodyLabelPlural = template.bodyLabelPlural;

  const frontMatterSpec = template.frontMatter
    .map((s) => `  * "${s.label}" (${s.required ? 'required' : 'optional'}) — ${s.description} [${s.minWords}-${s.maxWords} words]`)
    .join('\n');

  const backMatterSpec = template.backMatter
    .map((s) => `  * "${s.label}" (${s.required ? 'required' : 'optional'}) — ${s.description} [${s.minWords}-${s.maxWords} words]`)
    .join('\n');

  const systemPrompt = `You are an outline agent for a ${template.flavor} document. Produce a detailed ${bodyLabelPlural} structure.

STYLE GUIDE:
${template.writingStyleGuide}

OUTPUT REQUIREMENTS:
- Front matter:
${frontMatterSpec || '  (none)'}
- Body: Exactly ${bodyCount} ${bodyLabelPlural.toLowerCase()}. Each must:
  * Have a specific, promise-driven title
  * Progress logically
  * Cover ${template.bodyKeyPoints} key points (each concrete enough for 300+ words of prose)
  * Target ~${targetPerSection} words (range ${template.bodyMinWords}-${template.bodyMaxWords})
- Back matter:
${backMatterSpec || '  (none)'}

${feedback ? `AUTHOR FEEDBACK: ${feedback}\nRevise to address this while preserving what worked.` : ''}

Respond ONLY with valid JSON matching EXACTLY:
{
  "frontMatter": [
    { "title": "<label>", "description": "<1-2 sentences>", "keyPoints": ["..."], "estimatedWords": 1500 }
  ],
  "body": [
    {
      "number": 1,
      "key": "ch-1",
      "title": "<specific title>",
      "description": "<2-3 sentences>",
      "keyPoints": ["<point 1>", "<point 2>", "<point 3>"],
      "estimatedWords": ${targetPerSection}
    }
  ],
  "backMatter": [
    { "title": "<label>", "description": "<1-2 sentences>", "keyPoints": ["..."], "estimatedWords": 1500 }
  ]
}`;

  const userMessage = `Build the ${bodyLabelPlural.toLowerCase()} outline.

${formatBriefForPrompt(brief)}

Target: ~${bodyCount * targetPerSection} words across ${bodyCount} ${bodyLabelPlural.toLowerCase()}.`;

  const message = await anthropic.messages.create({
    model: modelFor(task),
    max_tokens: maxTokensFor(task),
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleanJson);
  parsed.body = parsed.body || parsed.chapters || [];
  parsed.frontMatter = parsed.frontMatter || [];
  parsed.backMatter = parsed.backMatter || [];
  return parsed;
}

// ============================================================================
// FIXED BODY (research papers, theses, business plans, contracts)
// ============================================================================

async function generateFixedOutline(
  brief: any,
  template: DocumentTemplate,
  feedback: string | undefined,
  task: 'outline_generate' | 'outline_refine',
) {
  const bodySections: DocumentSection[] = template.fixedBody || [];
  const frontSections = template.frontMatter;
  const backSections = template.backMatter;

  const citationStyleId = brief.followUp.citationStyle as string | undefined;
  const citationStyle = CITATION_STYLES.find((s) => s.id === citationStyleId);

  const citationDirective = template.requiresCitations
    ? `\n\nCITATIONS — MANDATORY:
- Every factual claim, statistic, or quote MUST be backed by a real, retrievable source.
- The author has chosen ${citationStyle ? `${citationStyle.label} style (example: ${citationStyle.example})` : '[citation style TBD — default to APA 7th]'}.
- Flag in keyPoints which points require citations.
- Do NOT invent citations at the outline stage — the writing agent pulls them from the approved research foundation.`
    : '';

  const sectionSpec = (sections: DocumentSection[]) =>
    sections
      .map(
        (s) =>
          `  - "${s.label}" [key=${s.key}] ${s.required ? '(required)' : '(optional)'}: ${s.description} [${s.minWords}-${s.maxWords} words]`,
      )
      .join('\n');

  const systemPrompt = `You are an outline agent for a ${template.flavor} document (content type: ${brief.contentType}).

STRICT FIXED STRUCTURE. You MUST emit EXACTLY the sections below, in exactly this order, using the exact section keys provided. Do NOT add, remove, rename, or reorder sections. Your only job is to tailor each section's description and keyPoints to the author's brief.

STYLE GUIDE:
${template.writingStyleGuide}
${citationDirective}

FRONT MATTER (exact order):
${frontSections.length ? sectionSpec(frontSections) : '  (none)'}

BODY — ${template.bodyLabelPlural} (exact order):
${sectionSpec(bodySections)}

BACK MATTER (exact order):
${backSections.length ? sectionSpec(backSections) : '  (none)'}

${feedback ? `\nAUTHOR FEEDBACK: ${feedback}\nRevise section descriptions and keyPoints only — do NOT change structure.` : ''}

Respond ONLY with valid JSON matching EXACTLY:
{
  "frontMatter": [
    { "key": "<key>", "title": "<label>", "description": "<tailored 1-2 sentences>", "keyPoints": ["..."], "estimatedWords": <number> }
  ],
  "body": [
    { "number": 1, "key": "<key>", "title": "<label>", "description": "<tailored 2-3 sentences>", "keyPoints": ["..."], "estimatedWords": <number> }
  ],
  "backMatter": [
    { "key": "<key>", "title": "<label>", "description": "<tailored 1-2 sentences>", "keyPoints": ["..."], "estimatedWords": <number> }
  ]
}`;

  const userMessage = `Build the outline for this ${template.flavor} document.

${formatBriefForPrompt(brief)}

Emit EXACTLY the fixed sections listed in the system prompt, in the exact order, with the exact keys. Tailor only titles, descriptions, and keyPoints.`;

  const message = await anthropic.messages.create({
    model: modelFor(task),
    max_tokens: maxTokensFor(task),
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleanJson);
  parsed.body = parsed.body || parsed.chapters || [];
  parsed.frontMatter = parsed.frontMatter || [];
  parsed.backMatter = parsed.backMatter || [];

  // Safety rail: if the AI drops a required body section, auto-insert from template
  const haveBodyKeys = new Set(parsed.body.map((b: any) => b.key));
  const missingBody = bodySections.filter((s) => s.required && !haveBodyKeys.has(s.key));
  if (missingBody.length > 0) {
    missingBody.forEach((s) => {
      parsed.body.push({
        number: 0,
        key: s.key,
        title: s.label,
        description: s.description,
        keyPoints: [],
        estimatedWords: Math.round((s.minWords + s.maxWords) / 2),
      });
    });
  }
  // Re-sort to template order + renumber
  parsed.body.sort(
    (a: any, b: any) =>
      bodySections.findIndex((s) => s.key === a.key) - bodySections.findIndex((s) => s.key === b.key),
  );
  parsed.body = parsed.body.map((b: any, i: number) => ({ ...b, number: i + 1 }));

  return parsed;
}
