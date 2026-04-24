import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor } from '@/lib/ai/model-router';
import {
  loadAgentBrief,
  resolveChapterCount,
  type AgentBrief,
} from '@/lib/ai/agent-brief';
import { getTemplate } from '@/lib/ai/document-templates';
import { fetchOutlineBundle, interpolateTemplate } from '@/lib/ai/outline-prompts-db';

/**
 * Outline endpoint — wired to resolve_outline_prompt (CEO-034).
 *
 * Every doc type's system prompt, user template, and output JSON Schema
 * comes from public.outline_prompts via the resolve_outline_prompt() RPC.
 * The agent interpolates {{topic}}, {{chapter_count_hint}},
 * {{interview_summary}}, {{validation_summary}}, and {{document_type}}
 * into the user template, calls Claude with row.system_prompt as the system
 * role, parses the response, and validates it against row.output_schema
 * (ajv). Up to 3 attempts are made with schema errors fed back into the
 * prompt; on final failure we persist {approved:false, error:…} so the
 * DB trigger accepts it and the watchdog surfaces the incident properly.
 *
 * Backwards-compat: outline_data retains its legacy fields (body, chapters,
 * frontMatter, backMatter, templateMeta) derived from `sections` so that
 * downstream consumers (app/api/books/generate, regenerate-chapter) work
 * unchanged.
 */

const anthropic = new Anthropic();
const ajv = new Ajv({ strict: false, allErrors: true });

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface OutlineSection {
  id: string;
  type: 'front_matter' | 'chapter' | 'back_matter';
  title: string;
  status: 'complete';
  description: string;
  keyPoints: string[];
  estimatedWords: number;
}

interface OutlineOutput {
  approved: boolean;
  sections?: OutlineSection[];
  error?: unknown;
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, feedback } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const brief = await loadAgentBrief(supabase, projectId, user.id);
    const task: 'outline_generate' | 'outline_refine' = feedback
      ? 'outline_refine'
      : 'outline_generate';

    // Pull the DB-backed prompt bundle. One RPC round-trip.
    const bundle = await fetchOutlineBundle(supabase, brief.contentType);
    if (!bundle) {
      return NextResponse.json(
        { error: `No outline prompt bundle resolvable for content_type='${brief.contentType}'` },
        { status: 500 }
      );
    }

    // Build template variables.
    const interviewSummary = buildInterviewSummary(brief);
    const validationSummary = buildValidationSummary(brief);
    const vars: Record<string, string> = {
      document_type: bundle.documentType,
      topic: buildTopic(brief),
      chapter_count_hint: String(resolveChapterCount(brief.followUp.chapters, 10)),
      interview_summary: interviewSummary,
      validation_summary: validationSummary,
    };

    const baseUserMessage = interpolateTemplate(bundle.userPromptTemplate, vars);
    const feedbackAddendum = feedback
      ? `\n\nAUTHOR FEEDBACK ON PREVIOUS OUTLINE: ${feedback}\nRevise to address this while preserving what worked. Return the full revised outline JSON.`
      : '';

    // Language preamble: ensure the author's chosen language is honoured
    // even when the DB system_prompt doesn't explicitly reference it.
    const languagePreamble =
      brief.language !== 'en'
        ? `LANGUAGE — CRITICAL: Write every section title, description, and keyPoint in ${brief.languageName}. Do not code-switch to English. Think in ${brief.languageName} from the first word.\n\n`
        : '';

    // Compile the JSON Schema validator from the DB row.
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(bundle.outputSchema);
    } catch (schemaErr) {
      // Malformed schema in the DB — caller gets a 500 and we surface it.
      return NextResponse.json(
        {
          error: 'Outline output_schema failed to compile',
          details: (schemaErr as Error).message,
        },
        { status: 500 }
      );
    }

    // Retry loop — up to 3 attempts, feeding ajv errors back on failure.
    const MAX_ATTEMPTS = 3;
    let parsed: OutlineOutput | null = null;
    let lastErrors: unknown = null;
    let userMessage = languagePreamble + baseUserMessage + feedbackAddendum;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const message = await anthropic.messages.create({
        model: modelFor(task),
        max_tokens: maxTokensFor(task),
        temperature: 0.4,
        system: bundle.systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const responseText =
        message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse
      let candidate: unknown;
      try {
        candidate = stripFencesAndParse(responseText);
      } catch (parseErr) {
        lastErrors = { parseError: (parseErr as Error).message };
        userMessage =
          languagePreamble + baseUserMessage + feedbackAddendum +
          `\n\nYour previous response was not valid JSON. Error: ${(parseErr as Error).message}\n` +
          `Return ONLY the JSON object. No markdown fences, no prose, no commentary.`;
        continue;
      }

      // Validate
      if (validate(candidate)) {
        parsed = candidate as OutlineOutput;
        break;
      }

      lastErrors = summariseAjvErrors(validate.errors);
      userMessage =
        languagePreamble + baseUserMessage + feedbackAddendum +
        `\n\nYour previous response failed schema validation. Errors:\n` +
        `${JSON.stringify(lastErrors, null, 2)}\n` +
        `Return ONLY the fully-corrected JSON object. Fix every listed issue.`;
    }

    // Build the row to write.
    const isValid = parsed !== null;
    const outlineData = isValid
      ? buildSuccessOutlineData(parsed!, brief, bundle)
      : buildFailureOutlineData(lastErrors);

    // Persist.
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
          outline_data: outlineData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionRow.id);
    }

    if (!isValid) {
      return NextResponse.json(
        {
          error: 'Outline failed schema validation after max retries',
          details: lastErrors,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(outlineData);
  } catch (error) {
    console.error('Outline error:', error);
    const msg = error instanceof Error ? error.message : 'Outline generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// Variable builders
// -----------------------------------------------------------------------------

function buildTopic(brief: AgentBrief): string {
  const parts: string[] = [brief.chosenIdea];
  if (brief.positioning) parts.push(`— positioning: ${brief.positioning}`);
  if (brief.uniqueAngle) parts.push(`— angle: ${brief.uniqueAngle}`);
  return parts.join(' ');
}

function buildInterviewSummary(brief: AgentBrief): string {
  if (!brief.interviewAnswers.length) return '(no interview answers on file)';
  return brief.interviewAnswers
    .map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`)
    .join('\n\n');
}

function buildValidationSummary(brief: AgentBrief): string {
  const v = brief.validationScore;
  if (!v && !brief.targetAudience && !brief.positioning) return '';
  const parts: string[] = [];
  if (v) {
    parts.push(`Market evaluation: ${v.total}/100 — verdict "${v.verdict}"`);
    if (v.strengths.length) parts.push(`Strengths to preserve: ${v.strengths.join('; ')}`);
    if (v.weaknesses.length) parts.push(`Weaknesses to mitigate: ${v.weaknesses.join('; ')}`);
  }
  if (brief.targetAudience) parts.push(`Target audience: ${brief.targetAudience}`);
  if (brief.followUp.market) parts.push(`Target market: ${brief.followUp.market}`);
  if (brief.followUp.style) parts.push(`Writing style: ${brief.followUp.style}`);
  return parts.join('\n');
}

// -----------------------------------------------------------------------------
// Parsing helpers
// -----------------------------------------------------------------------------

function stripFencesAndParse(raw: string): unknown {
  const clean = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(clean);
}

function summariseAjvErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors) return null;
  return errors.slice(0, 20).map((e) => ({
    path: e.instancePath || '(root)',
    keyword: e.keyword,
    message: e.message,
    params: e.params,
  }));
}

// -----------------------------------------------------------------------------
// Persistence-shape builders (preserve backward-compat)
// -----------------------------------------------------------------------------

function buildSuccessOutlineData(
  parsed: OutlineOutput,
  brief: AgentBrief,
  bundle: { documentType: string; isFallback: boolean }
) {
  const sections = parsed.sections ?? [];
  const frontMatter = sections.filter((s) => s.type === 'front_matter');
  const chapters = sections.filter((s) => s.type === 'chapter');
  const backMatter = sections.filter((s) => s.type === 'back_matter');

  // Legacy `body` / `chapters` — downstream (books/generate/route.ts line 217+,
  // regenerate-chapter line 140) expects this shape. We build it from `sections`
  // so the DB schema stays clean and the writing pipeline keeps working.
  const body = chapters.map((c, i) => ({
    number: i + 1,
    key: c.id,
    title: c.title,
    description: c.description,
    keyPoints: c.keyPoints,
    estimatedWords: c.estimatedWords,
  }));

  // Template metadata. Prefer the local registry (has citation style guide
  // etc.), but if the content_type isn't known there, synthesise from the
  // DB resolver output so downstream reads don't crash.
  let templateMeta: Record<string, unknown> = {
    flavor: bundle.documentType,
    bodyLabelSingular: 'Chapter',
    bodyLabelPlural: 'Chapters',
    bodyIsVariable: true,
    requiresCitations: false,
    writingStyleGuide: '',
    citationStyle: brief.followUp.citationStyle,
    resolvedFromDb: true,
    resolvedDocumentType: bundle.documentType,
    isFallback: bundle.isFallback,
  };
  try {
    const tmpl = getTemplate(brief.contentType);
    if (tmpl) {
      templateMeta = {
        flavor: tmpl.flavor,
        bodyLabelSingular: tmpl.bodyLabelSingular,
        bodyLabelPlural: tmpl.bodyLabelPlural,
        bodyIsVariable: tmpl.bodyIsVariable,
        requiresCitations: tmpl.requiresCitations,
        writingStyleGuide: tmpl.writingStyleGuide,
        citationStyle: brief.followUp.citationStyle,
        resolvedFromDb: true,
        resolvedDocumentType: bundle.documentType,
        isFallback: bundle.isFallback,
      };
    }
  } catch {
    // Keep default templateMeta.
  }

  return {
    approved: true,
    sections,
    body,
    chapters: body, // legacy alias
    frontMatter: frontMatter.map((s) => ({
      title: s.title,
      description: s.description,
      keyPoints: s.keyPoints,
      estimatedWords: s.estimatedWords,
      key: s.id,
    })),
    backMatter: backMatter.map((s) => ({
      title: s.title,
      description: s.description,
      keyPoints: s.keyPoints,
      estimatedWords: s.estimatedWords,
      key: s.id,
    })),
    templateMeta,
    generatedAt: new Date().toISOString(),
  };
}

function buildFailureOutlineData(errors: unknown) {
  return {
    approved: false,
    sections: [],
    error: errors ?? 'Outline schema validation failed after max retries',
    generatedAt: new Date().toISOString(),
  };
}
