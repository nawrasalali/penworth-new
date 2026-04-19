import { inngest } from '../client';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { buildSystemPrompt, getPromptById } from '@/lib/industry-prompts';
import { modelFor, maxTokensFor, calculateCost as calcCostByTask } from '@/lib/ai/model-router';
import {
  pulseHeartbeat,
  markAgentCompleted,
  logIncident,
  bumpFailureCount,
} from '@/lib/pipeline/heartbeat';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * BodySection — one unit the writing agent produces. Comes from the outline's
 * `body` array. For a book these are chapters; for a research paper they are
 * IMRaD sections; for a contract they are clauses.
 */
interface BodySection {
  number: number;
  key?: string;
  title: string;
  description: string;
  keyPoints: string[];
  estimatedWords: number;
}

interface MatterSection {
  key?: string;
  title: string;
  description: string;
  keyPoints?: string[];
  estimatedWords?: number;
}

interface TemplateMeta {
  flavor: 'narrative' | 'instructional' | 'academic' | 'business' | 'legal' | 'technical' | 'reference' | 'short_form';
  bodyLabelSingular: string;
  bodyLabelPlural: string;
  bodyIsVariable: boolean;
  requiresCitations: boolean;
  writingStyleGuide: string;
  citationStyle?: string;
}

interface VoiceProfile {
  tone: string;
  style: string;
  vocabulary: string;
}

/**
 * Writing pipeline — durable execution for any document type.
 *
 * Iterates front matter -> body -> back matter in order. Each section writes
 * as its own durable step so partial failures are retriable. The chapter
 * prompt is driven by the template flavor and style guide, so a research
 * paper gets IMRaD prose (no "Chapter 1:" prefix) while a book gets
 * chapter prose. Citation-required documents get strict citation rules
 * appended to the system prompt.
 */
export const writeBook = inngest.createFunction(
  {
    id: 'write-book',
    name: 'Write Complete Document',
    retries: 3,
    // When every retry of a step is exhausted, Inngest marks the whole
    // function as failed and calls onFailure. This is the end-of-line
    // hook — a stuck step is now definitively dead. We:
    //   1. Mark the session pipeline_status='failed' so the UI stops
    //      showing "Nora is investigating" and shows the retry/resume
    //      affordance instead.
    //   2. Log a p0 incident so the founder gets paged immediately via
    //      the auto-alert trigger.
    //   3. Mark the project status='error' so the /generate/stream SSE
    //      closes cleanly (it watches projects.status transitions).
    // Everything is wrapped so an onFailure failure never becomes a
    // secondary incident loop.
    onFailure: async (ctx: any) => {
      try {
        // The onFailure event wraps the original trigger. Inngest v4
        // shape: ctx.event.data.event.data is the original payload,
        // ctx.event.data.error is the failure.
        const originalData =
          ctx?.event?.data?.event?.data ?? ctx?.event?.data ?? {};
        const projectId: string | undefined = originalData.projectId;
        const userId: string | undefined = originalData.userId;
        const errorMessage: string =
          ctx?.error?.message ??
          ctx?.event?.data?.error?.message ??
          'Inngest function failed after exhausting retries';

        if (!projectId || !userId) {
          console.error('[write-book.onFailure] missing projectId/userId in payload', ctx?.event);
          return;
        }

        // Re-resolve sessionId. We can't rely on the memoized projectCtx
        // here — onFailure runs in a fresh context.
        const { findSessionIdForProject } = await import('@/lib/pipeline/heartbeat');
        const sessionId = await findSessionIdForProject(projectId, userId);

        // Mark session + project as failed. Use the service client
        // directly rather than pulseHeartbeat, because we need both
        // the pipeline_status flip AND the last_failure_reason in one
        // shot for clear dashboard state.
        const { createServiceClient } = await import('@/lib/supabase/service');
        const admin = createServiceClient();
        if (sessionId) {
          await admin
            .from('interview_sessions')
            .update({
              pipeline_status: 'failed',
              agent_heartbeat_at: new Date().toISOString(),
              last_failure_at: new Date().toISOString(),
              last_failure_reason: `Inngest onFailure: ${errorMessage}`.slice(0, 500),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);
        }
        await admin
          .from('projects')
          .update({
            status: 'error',
            metadata: {
              errorMessage,
              failedAt: new Date().toISOString(),
            },
          })
          .eq('id', projectId);

        // p0: every retry failed, pipeline is dead, founder needs paging.
        await logIncident({
          sessionId,
          userId,
          agent: 'writing',
          incidentType: 'infrastructure_error',
          severity: 'p0',
          details: {
            source: 'inngest_onFailure',
            projectId,
            message: errorMessage,
            runId: ctx?.runId ?? null,
          },
        });
      } catch (hookErr) {
        // Never let an onFailure hook throw — Inngest would log it as a
        // separate failure and potentially loop. The stuck detector
        // will still catch the session when its heartbeat goes stale.
        console.error('[write-book.onFailure] hook itself threw:', hookErr);
      }
    },
    triggers: [{ event: 'book/write' }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { projectId, userId, title, outline, industry, voiceProfile } = event.data as {
      projectId: string;
      userId: string;
      title: string;
      outline: {
        body?: BodySection[];
        chapters?: BodySection[]; // legacy
        frontMatter?: MatterSection[];
        backMatter?: MatterSection[];
        templateMeta?: TemplateMeta;
      };
      industry: string;
      voiceProfile?: VoiceProfile;
    };

    // Defaults if templateMeta is missing (legacy flow)
    const meta: TemplateMeta = outline.templateMeta || {
      flavor: 'narrative',
      bodyLabelSingular: 'Chapter',
      bodyLabelPlural: 'Chapters',
      bodyIsVariable: true,
      requiresCitations: false,
      writingStyleGuide: 'Clear, engaging prose in the author\'s voice.',
    };

    const body: BodySection[] = outline.body || outline.chapters || [];
    const frontMatter: MatterSection[] = outline.frontMatter || [];
    const backMatter: MatterSection[] = outline.backMatter || [];

    if (body.length === 0) {
      throw new Error('Outline has no body sections — nothing to write');
    }

    // Load the brief's research + author info once, pass to every section.
    // Also expose sessionId so each step can pulse the heartbeat. Absence
    // of a session is logged but not fatal — legacy projects may not
    // have one and we'd rather generate the book than refuse.
    const projectCtx = await step.run('load-context', async () => {
      const { data: session } = await supabase
        .from('interview_sessions')
        .select('id, validation_data, interview_data, research_data, follow_up_data, author_name, about_author')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (!session?.id) {
        console.warn(
          `[write-book] No interview_sessions row for project ${projectId} — pipeline-health monitoring will be skipped for this run.`,
        );
      }

      const { data: resources } = session?.id
        ? await supabase
            .from('research_resources')
            .select('title, url, content_summary, resource_type')
            .eq('session_id', session.id)
            .eq('is_selected', true)
        : { data: [] };

      const { data: profile } = await supabase
        .from('profiles')
        .select('preferred_language')
        .eq('id', userId)
        .single();

      return {
        sessionId: session?.id as string | undefined,
        chosenIdea: session?.validation_data?.chosenIdea || title,
        authorName: session?.author_name,
        aboutAuthor: session?.about_author,
        citationStyle: session?.follow_up_data?.citationStyle || meta.citationStyle,
        research: resources || [],
        language: profile?.preferred_language || 'en',
      };
    });

    const sessionId = projectCtx.sessionId ?? null;

    // Total sections = front + body + back
    const totalSections = frontMatter.length + body.length + backMatter.length;

    await step.run('initialize-project', async () => {
      // Pipeline entry: mark the writing agent as active with a fresh
      // heartbeat. `markStart` stamps agent_started_at — the stuck
      // detector falls back to updated_at via COALESCE if heartbeat is
      // NULL, but having both is cleaner for the dashboards.
      await pulseHeartbeat(sessionId, {
        markStart: true,
        agent: 'writing',
        pipelineStatus: 'active',
      });

      await supabase
        .from('projects')
        .update({
          status: 'writing',
          metadata: {
            totalChapters: totalSections,
            totalBody: body.length,
            completedChapters: 0,
            flavor: meta.flavor,
            startedAt: new Date().toISOString(),
          },
        })
        .eq('id', projectId);
    });

    const written: Array<{ chapterId: string; title: string; wordCount: number }> = [];
    let orderIndex = 0;

    // --- FRONT MATTER ---
    for (let i = 0; i < frontMatter.length; i++) {
      const fm = frontMatter[i];
      const stepName = `front-${i}`;
      const result = await step.run(stepName, async () => {
        // Pulse at every retry of this step, not just the first — that's
        // why the call lives inside the step body rather than outside.
        await pulseHeartbeat(sessionId, { agent: 'writing' });
        try {
          return await writeSection({
            kind: 'front_matter',
            title: fm.title,
            description: fm.description,
            keyPoints: fm.keyPoints || [],
            targetWords: fm.estimatedWords || 1500,
            projectId,
            userId,
            docTitle: title,
            orderIndex: orderIndex,
            meta,
            voiceProfile,
            projectCtx,
            prior: written.map((w) => w.title).join(', '),
            industry,
          });
        } catch (err) {
          // p3 = audit-only. Step will retry (Inngest retries:3 at fn
          // level). If every retry fails, onFailure fires a p0.
          await logIncident({
            sessionId,
            userId,
            agent: 'writing',
            incidentType: classifyError(err),
            severity: 'p3',
            details: {
              step: stepName,
              sectionTitle: fm.title,
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
            },
          });
          await bumpFailureCount(
            sessionId,
            `${stepName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      });
      written.push(result);
      orderIndex += 1;
      // Pulse once more on successful step completion so the next
      // step's entry heartbeat is redundant-but-safe.
      await pulseHeartbeat(sessionId);
    }

    // --- BODY (chapters / sections / clauses / recipes) ---
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      const stepName = `body-${i + 1}`;
      const result = await step.run(stepName, async () => {
        await pulseHeartbeat(sessionId, { agent: 'writing' });
        try {
          return await writeSection({
            kind: 'body',
            title: b.title,
            description: b.description,
            keyPoints: b.keyPoints || [],
            targetWords: b.estimatedWords || 3000,
            bodyNumber: b.number,
            projectId,
            userId,
            docTitle: title,
            orderIndex: orderIndex,
            meta,
            voiceProfile,
            projectCtx,
            prior: written.map((w) => w.title).join(', '),
            industry,
          });
        } catch (err) {
          await logIncident({
            sessionId,
            userId,
            agent: 'writing',
            incidentType: classifyError(err),
            severity: 'p3',
            details: {
              step: stepName,
              sectionTitle: b.title,
              bodyNumber: b.number,
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
            },
          });
          await bumpFailureCount(
            sessionId,
            `${stepName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      });
      written.push(result);
      orderIndex += 1;

      await pulseHeartbeat(sessionId);

      await supabase
        .from('projects')
        .update({
          metadata: {
            totalChapters: totalSections,
            completedChapters: orderIndex,
            lastUpdatedAt: new Date().toISOString(),
          },
        })
        .eq('id', projectId);
    }

    // --- BACK MATTER ---
    for (let i = 0; i < backMatter.length; i++) {
      const bm = backMatter[i];
      const stepName = `back-${i}`;
      const result = await step.run(stepName, async () => {
        await pulseHeartbeat(sessionId, { agent: 'writing' });
        try {
          return await writeSection({
            kind: 'back_matter',
            title: bm.title,
            description: bm.description,
            keyPoints: bm.keyPoints || [],
            targetWords: bm.estimatedWords || 1500,
            projectId,
            userId,
            docTitle: title,
            orderIndex: orderIndex,
            meta,
            voiceProfile,
            projectCtx,
            prior: written.map((w) => w.title).join(', '),
            industry,
          });
        } catch (err) {
          await logIncident({
            sessionId,
            userId,
            agent: 'writing',
            incidentType: classifyError(err),
            severity: 'p3',
            details: {
              step: stepName,
              sectionTitle: bm.title,
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
            },
          });
          await bumpFailureCount(
            sessionId,
            `${stepName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      });
      written.push(result);
      orderIndex += 1;
      await pulseHeartbeat(sessionId);
    }

    // --- FINALIZE ---
    const finalResult = await step.run('finalize', async () => {
      const totalWordCount = written.reduce((s, w) => s + w.wordCount, 0);

      await supabase
        .from('projects')
        .update({
          status: 'complete',
          metadata: {
            totalChapters: totalSections,
            completedChapters: totalSections,
            totalWordCount,
            flavor: meta.flavor,
            completedAt: new Date().toISOString(),
          },
        })
        .eq('id', projectId);

      // Flip the writing agent to 'completed' in agent_status and mark
      // the pipeline as 'completed'. The next agent (qa) will be
      // re-activated when the frontend calls /api/interview-session
      // advance, which pulses pipelineStatus='active' again.
      await markAgentCompleted(sessionId, 'writing');
      await pulseHeartbeat(sessionId, { pipelineStatus: 'completed' });

      const { count: completedCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'complete');

      if (completedCount === 1) {
        await triggerReferralCredits(userId, projectId, title);
      }

      return {
        success: true,
        totalChapters: totalSections,
        totalWordCount,
        chapters: written,
        isFirstBook: completedCount === 1,
      };
    });

    return finalResult;
  }
);

// ============================================================================
// writeSection — generic prose generator, flavor-aware
// ============================================================================

interface WriteSectionInput {
  kind: 'front_matter' | 'body' | 'back_matter';
  title: string;
  description: string;
  keyPoints: string[];
  targetWords: number;
  bodyNumber?: number;
  projectId: string;
  userId: string;
  docTitle: string;
  orderIndex: number;
  meta: TemplateMeta;
  voiceProfile?: VoiceProfile;
  projectCtx: {
    chosenIdea: string;
    authorName?: string;
    aboutAuthor?: string;
    citationStyle?: string;
    research: Array<{ title: string; url?: string | null; content_summary?: string | null; resource_type?: string }>;
    language: string;
  };
  prior: string;
  industry: string;
}

async function writeSection(inp: WriteSectionInput) {
  const { kind, title, description, keyPoints, targetWords, bodyNumber, projectId, userId, docTitle, orderIndex, meta, voiceProfile, projectCtx, prior, industry } = inp;

  const userPrompt = buildSectionPrompt({
    kind,
    docTitle,
    sectionTitle: title,
    sectionDescription: description,
    keyPoints,
    targetWords,
    bodyNumber,
    bodyLabel: meta.bodyLabelSingular,
    flavor: meta.flavor,
    styleGuide: meta.writingStyleGuide,
    requiresCitations: meta.requiresCitations,
    citationStyle: projectCtx.citationStyle,
    research: projectCtx.research,
    prior,
    voiceProfile,
  });

  const systemPrompt = buildFlavoredSystemPrompt({
    industry,
    voiceProfile,
    flavor: meta.flavor,
    styleGuide: meta.writingStyleGuide,
    requiresCitations: meta.requiresCitations,
    citationStyle: projectCtx.citationStyle,
    language: projectCtx.language,
  });

  const writeModel = modelFor('write_chapter');
  // Prompt caching: mark the system prompt as cacheable. The system
  // prompt is identical across every chapter of a single book (same
  // industry prompt, voice guide, flavor prelude, language directive).
  // First chapter pays the 1.25× cache-write premium; every chapter
  // after gets a 10× cheaper cache-read on the same ~2-4k token block.
  // 5-minute TTL by default, which comfortably covers the 3-8 minute
  // book-writing window.
  const response = await anthropic.messages.create({
    model: writeModel,
    max_tokens: maxTokensFor('write_chapter'),
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  // Cache token fields are optional in the SDK typing — present when
  // caching was exercised, undefined otherwise. Coalesce to 0 so the
  // cost calc stays stable for legacy non-cached calls.
  const cacheRead = (response.usage as any).cache_read_input_tokens ?? 0;
  const cacheCreation = (response.usage as any).cache_creation_input_tokens ?? 0;

  const { data: saved, error } = await supabase
    .from('chapters')
    .insert({
      project_id: projectId,
      title: title,
      content,
      order_index: orderIndex,
      status: 'complete',
      word_count: wordCount,
      metadata: {
        kind,
        flavor: meta.flavor,
        bodyNumber,
        generatedAt: new Date().toISOString(),
        model: writeModel,
        tokensUsed: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead,
          cacheCreation,
        },
      },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save section: ${error.message}`);

  await supabase.from('usage').insert({
    user_id: userId,
    action_type: 'section_write',
    tokens_input: response.usage.input_tokens,
    tokens_output: response.usage.output_tokens,
    model: writeModel,
    cost_usd: calcCostByTask(
      'write_chapter',
      response.usage.input_tokens,
      response.usage.output_tokens,
      cacheRead,
      cacheCreation,
    ),
    metadata: {
      projectId,
      chapterId: saved.id,
      sectionKind: kind,
      orderIndex,
      // Separate cache stats from the main token counts so the CFO
      // Agent can show cache hit rate per book in the future.
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
    },
  });

  return { chapterId: saved.id, title, wordCount };
}

function buildSectionPrompt(p: {
  kind: 'front_matter' | 'body' | 'back_matter';
  docTitle: string;
  sectionTitle: string;
  sectionDescription: string;
  keyPoints: string[];
  targetWords: number;
  bodyNumber?: number;
  bodyLabel: string;
  flavor: TemplateMeta['flavor'];
  styleGuide: string;
  requiresCitations: boolean;
  citationStyle?: string;
  research: Array<{ title: string; url?: string | null; content_summary?: string | null; resource_type?: string }>;
  prior: string;
  voiceProfile?: VoiceProfile;
}): string {
  const parts: string[] = [];

  // Heading tells the model which kind of section this is
  if (p.kind === 'body' && p.bodyNumber && p.flavor === 'narrative') {
    parts.push(`Write ${p.bodyLabel} ${p.bodyNumber} of "${p.docTitle}".`);
  } else if (p.kind === 'body') {
    parts.push(`Write the "${p.sectionTitle}" section of "${p.docTitle}".`);
  } else if (p.kind === 'front_matter') {
    parts.push(`Write the "${p.sectionTitle}" (front matter) of "${p.docTitle}".`);
  } else {
    parts.push(`Write the "${p.sectionTitle}" (back matter) of "${p.docTitle}".`);
  }

  parts.push('');
  parts.push('## Section Details');
  parts.push(`- Title: ${p.sectionTitle}`);
  parts.push(`- Description: ${p.sectionDescription}`);
  if (p.keyPoints.length > 0) {
    parts.push(`- Points to cover:`);
    p.keyPoints.forEach((pt) => parts.push(`  - ${pt}`));
  }
  parts.push(`- Target length: ~${p.targetWords.toLocaleString()} words`);

  if (p.prior) {
    parts.push('');
    parts.push(`## Previously written (for continuity): ${p.prior}`);
  }

  if (p.voiceProfile) {
    parts.push('');
    parts.push(`## Voice`);
    parts.push(`- Tone: ${p.voiceProfile.tone}`);
    parts.push(`- Style: ${p.voiceProfile.style}`);
    parts.push(`- Vocabulary: ${p.voiceProfile.vocabulary}`);
  }

  // Research foundation — the author-approved sources they can draw from
  if (p.research.length > 0) {
    parts.push('');
    parts.push('## Research Foundation (author-approved sources)');
    p.research.slice(0, 20).forEach((r, i) => {
      parts.push(`${i + 1}. ${r.title}${r.url ? ` — ${r.url}` : ''}${r.content_summary ? `\n   ${r.content_summary}` : ''}`);
    });
    if (p.requiresCitations) {
      parts.push('');
      parts.push(
        `## CITATIONS — MANDATORY for this document\n- Every factual claim, statistic, or quotation MUST cite one of the sources listed above.\n- Citation style: ${p.citationStyle || 'APA 7th'}.\n- If a claim cannot be backed by a listed source, OMIT it. Do NOT invent citations, DOIs, page numbers, or author names.\n- Include in-text citations at the end of each cited sentence.\n- For ${p.sectionTitle === 'References' || p.sectionTitle === 'Bibliography' ? 'THIS IS THE REFERENCES section — emit the full reference list in the chosen style, drawn ONLY from the approved sources above.' : 'every claim, cite its source.'}`
      );
    }
  } else if (p.requiresCitations) {
    parts.push('');
    parts.push(
      `## WARNING: No approved research sources provided.\n- This document requires citations but no research foundation was supplied.\n- Write ONLY content you can defend without specific citations (definitions, general knowledge, structural prose).\n- Do NOT fabricate sources, authors, or statistics.\n- Flag in the prose where a citation would belong so the author can add sources later.`
    );
  }

  parts.push('');
  parts.push('## Requirements');
  // Flavor-specific formatting instructions
  switch (p.flavor) {
    case 'narrative':
      parts.push('1. Write in flowing prose with clear paragraph breaks.');
      parts.push('2. Use subheadings where they aid navigation.');
      parts.push(`3. End with a natural transition${p.kind === 'body' ? ' to the next chapter' : ''} (if not the final section).`);
      break;
    case 'academic':
      parts.push('1. Academic register. Third-person where appropriate.');
      parts.push('2. Use clear subsection headings.');
      parts.push('3. Every factual claim carries an in-text citation.');
      parts.push('4. No rhetorical flourish. No unsupported generalisations.');
      break;
    case 'business':
      parts.push('1. Confident, data-driven prose.');
      parts.push('2. Use bullet points, tables, and numbered lists where helpful.');
      parts.push('3. Back market claims with cited sources or explicit "author assumption:" callouts.');
      break;
    case 'legal':
      parts.push('1. Formal legal register. No marketing tone.');
      parts.push('2. Use numbered clauses (1., 1.1., 1.1.1) for structure.');
      parts.push('3. Defined terms in Title Case, referenced exactly as defined.');
      parts.push('4. End with: "This document was generated by AI and should be reviewed by qualified counsel before execution."');
      break;
    case 'technical':
      parts.push('1. Imperative voice. Clear, precise.');
      parts.push('2. Use properly fenced code blocks with language tags for any code.');
      parts.push('3. Use tables for reference material.');
      parts.push('4. Every code example must be complete and runnable.');
      break;
    case 'reference':
      parts.push('1. Each entry is self-contained.');
      parts.push('2. Use a consistent template across entries (headnote, ingredients/list, steps, notes).');
      break;
    case 'short_form':
      parts.push('1. Economical prose. Strong opening and closing.');
      parts.push('2. Show, don\'t tell.');
      break;
    default:
      parts.push('1. Clear, well-structured prose.');
  }

  parts.push('');
  parts.push(`Write the complete section now. Aim for ~${p.targetWords.toLocaleString()} words.`);
  return parts.join('\n');
}

function buildFlavoredSystemPrompt(p: {
  industry: string;
  voiceProfile?: VoiceProfile;
  flavor: TemplateMeta['flavor'];
  styleGuide: string;
  requiresCitations: boolean;
  citationStyle?: string;
  language: string;
}): string {
  const industryPrompt = getPromptById(p.industry);
  let base = industryPrompt?.systemPrompt || buildSystemPrompt('general');

  // Language directive (non-negotiable)
  if (p.language !== 'en') {
    const LANG_NAMES: Record<string, string> = {
      ar: 'Arabic', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)',
      bn: 'Bengali', hi: 'Hindi', id: 'Indonesian', fr: 'French', vi: 'Vietnamese',
    };
    base = `## LANGUAGE — CRITICAL\nEvery word you produce MUST be in ${LANG_NAMES[p.language] || p.language}. Do not write English and translate. Think and compose natively in ${LANG_NAMES[p.language] || p.language}.\n\n${base}`;
  }

  // Flavor-specific system prelude
  const flavorPrelude: Record<string, string> = {
    narrative: 'You are a bestselling narrative author. Voice-driven prose. Strong openings and closings. Stories and examples.',
    academic: 'You are a rigorous academic writer. Every factual claim is cited. No speculation. No unsupported generalisations. You use the author\'s chosen citation style consistently and never invent sources.',
    business: 'You are a senior management consultant writing investor-ready business documents. You use data. You cite sources for market claims.',
    legal: 'You are a legal drafting specialist. Precise, unambiguous, formal. You use numbered clauses and defined terms. You include a disclaimer recommending review by qualified counsel.',
    technical: 'You are a senior technical writer. Clear, imperative, accurate. You verify code examples are complete and runnable.',
    reference: 'You are a reference-book author. Consistent structure across entries. Warm, inviting prose between entries.',
    short_form: 'You are an award-winning short-form writer. Economical prose. Strong arc.',
    instructional: 'You are an instructional-design author. Clear learning objectives per section. Examples, then exercises.',
  };
  base = `${flavorPrelude[p.flavor] || flavorPrelude.narrative}\n\nSTYLE GUIDE FOR THIS DOCUMENT:\n${p.styleGuide}\n\n${base}`;

  if (p.requiresCitations) {
    base += `\n\n## CITATIONS — HARD RULE\nYou MUST cite every factual claim, statistic, or quotation with an in-text citation in ${p.citationStyle || 'APA 7th'} style, drawing ONLY from the approved research foundation provided in the user message. You MUST NOT invent sources, DOIs, author names, journal names, page numbers, or dates. If no listed source supports a claim, you MUST omit that claim. A sentence with no citation must be defensible as a definition, structural prose, or plainly-known fact.`;
  }

  if (p.voiceProfile) {
    base += `\n\n## Voice Guidelines\n- Tone: ${p.voiceProfile.tone}\n- Style: ${p.voiceProfile.style}\n- Vocabulary: ${p.voiceProfile.vocabulary}`;
  }

  base += `\n\n## Formatting Requirements\n- Clear, engaging, authoritative prose suited to the document type above.\n- Well-structured paragraphs with headings where appropriate.\n- No filler. No repetition.\n- Output publication-ready.`;

  return base;
}

async function triggerReferralCredits(userId: string, projectId: string, bookTitle: string) {
  const REFERRAL_CREDITS = 500;
  try {
    const { data: referral } = await supabase
      .from('referrals')
      .select('referrer_id, status')
      .eq('referee_id', userId)
      .eq('status', 'pending')
      .single();

    if (!referral) return;

    await supabase
      .from('referrals')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        first_book_id: projectId,
      })
      .eq('referee_id', userId);

    const { data: referrerProfile } = await supabase
      .from('profiles')
      .select('credits_balance, credits_purchased')
      .eq('id', referral.referrer_id)
      .single();

    if (!referrerProfile) return;

    const newCreditsPurchased = (referrerProfile.credits_purchased || 0) + REFERRAL_CREDITS;

    await supabase
      .from('profiles')
      .update({ credits_purchased: newCreditsPurchased })
      .eq('id', referral.referrer_id);

    await supabase.from('credit_transactions').insert({
      user_id: referral.referrer_id,
      amount: REFERRAL_CREDITS,
      type: 'referral_bonus',
      description: `Referral bonus: Friend completed their first document "${bookTitle}"`,
      metadata: { refereeId: userId, projectId, bookTitle },
    });
  } catch (error) {
    console.error('Error triggering referral credits:', error);
  }
}

/**
 * Map a thrown error into one of the pipeline_incidents.incident_type
 * enum values. Best-effort string matching — the Anthropic SDK tags
 * errors with status codes we can read.
 */
function classifyError(err: unknown): 'api_rate_limit' | 'api_error' | 'token_budget_exhausted' | 'infrastructure_error' | 'unknown' {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const status = (err as any)?.status ?? (err as any)?.statusCode;

    if (status === 429 || msg.includes('rate limit') || msg.includes('rate_limit')) {
      return 'api_rate_limit';
    }
    if (msg.includes('max_tokens') || msg.includes('context length') || msg.includes('token budget')) {
      return 'token_budget_exhausted';
    }
    if (typeof status === 'number' && status >= 500) {
      return 'api_error';
    }
    if (typeof status === 'number' && status >= 400) {
      return 'api_error';
    }
    if (msg.includes('etimedout') || msg.includes('econnrefused') || msg.includes('socket hang up')) {
      return 'infrastructure_error';
    }
  }
  return 'unknown';
}

export default writeBook;
