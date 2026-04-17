import { inngest } from '../client';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { buildSystemPrompt, getPromptById } from '@/lib/industry-prompts';
import { modelFor, maxTokensFor, calculateCost as calcCostByTask } from '@/lib/ai/model-router';

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

    // Load the brief's research + author info once, pass to every section
    const projectCtx = await step.run('load-context', async () => {
      const { data: session } = await supabase
        .from('interview_sessions')
        .select('id, validation_data, interview_data, research_data, follow_up_data, author_name, about_author')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

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
        chosenIdea: session?.validation_data?.chosenIdea || title,
        authorName: session?.author_name,
        aboutAuthor: session?.about_author,
        citationStyle: session?.follow_up_data?.citationStyle || meta.citationStyle,
        research: resources || [],
        language: profile?.preferred_language || 'en',
      };
    });

    // Total sections = front + body + back
    const totalSections = frontMatter.length + body.length + backMatter.length;

    await step.run('initialize-project', async () => {
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
      const result = await step.run(`front-${i}`, async () => {
        return writeSection({
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
      });
      written.push(result);
      orderIndex += 1;
    }

    // --- BODY (chapters / sections / clauses / recipes) ---
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      const result = await step.run(`body-${i + 1}`, async () => {
        return writeSection({
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
      });
      written.push(result);
      orderIndex += 1;

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
      const result = await step.run(`back-${i}`, async () => {
        return writeSection({
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
      });
      written.push(result);
      orderIndex += 1;
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
  const response = await anthropic.messages.create({
    model: writeModel,
    max_tokens: maxTokensFor('write_chapter'),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

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
    cost_usd: calcCostByTask('write_chapter', response.usage.input_tokens, response.usage.output_tokens),
    metadata: { projectId, chapterId: saved.id, sectionKind: kind, orderIndex },
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

export default writeBook;
