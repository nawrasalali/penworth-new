import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt } from '@/lib/ai/agent-brief';
import { CREDIT_COSTS } from '@/types/agent-workflow';

const anthropic = new Anthropic();

/**
 * Regenerate a single chapter with Opus.
 *
 * Flow:
 *   1. Verify ownership + chapter exists
 *   2. Verify user has enough credits (CREDIT_COSTS.CHAPTER_REGENERATE = 100)
 *   3. Atomically deduct credits BEFORE the expensive API call
 *   4. Build a brief-grounded prompt (uses interview context + existing chapter
 *      as context, optional author instructions)
 *   5. Stream/await Opus completion
 *   6. Update the chapter row with new content + word count + metadata
 *   7. Log to chapter_regenerations + credit_transactions + usage
 *
 * If the API call fails after credit deduction, credits are refunded.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, chapterId, instructions } = await request.json();
  if (!projectId || !chapterId) {
    return NextResponse.json({ error: 'projectId and chapterId are required' }, { status: 400 });
  }

  // Verify chapter ownership via the project
  const { data: chapter, error: chapterErr } = await supabase
    .from('chapters')
    .select('id, project_id, title, content, order_index, metadata')
    .eq('id', chapterId)
    .eq('project_id', projectId)
    .single();

  if (chapterErr || !chapter) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id, user_id, title, description, content_type')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projectErr || !project) {
    return NextResponse.json({ error: 'Project not found or not owned by user' }, { status: 404 });
  }

  // Check credit balance
  const cost = CREDIT_COSTS.CHAPTER_REGENERATE; // 100
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('credits_balance, credits_purchased, is_admin')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const totalCredits = (profile.credits_balance || 0) + (profile.credits_purchased || 0);
  if (totalCredits < cost && !profile.is_admin) {
    return NextResponse.json(
      {
        error: `Not enough credits. Chapter regeneration costs ${cost} credits.`,
        code: 'INSUFFICIENT_CREDITS',
        required: cost,
        available: totalCredits,
      },
      { status: 403 },
    );
  }

  // Deduct credits atomically BEFORE the expensive API call.
  // Prefer monthly balance, fall back to purchased.
  let newBalance = profile.credits_balance || 0;
  let newPurchased = profile.credits_purchased || 0;
  if (!profile.is_admin) {
    if (newBalance >= cost) {
      newBalance -= cost;
    } else {
      const fromPurchased = cost - newBalance;
      newBalance = 0;
      newPurchased -= fromPurchased;
    }

    const { error: deductErr } = await supabase
      .from('profiles')
      .update({ credits_balance: newBalance, credits_purchased: newPurchased })
      .eq('id', user.id);
    if (deductErr) {
      return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 });
    }
  }

  // Helper: refund if the rest of the flow fails
  const refundCredits = async () => {
    if (profile.is_admin) return;
    await supabase
      .from('profiles')
      .update({
        credits_balance: profile.credits_balance,
        credits_purchased: profile.credits_purchased,
      })
      .eq('id', user.id);
  };

  // Build a grounded prompt. Pull the full agent brief so the regen chapter
  // stays consistent with the book's intent, voice, and outline.
  let brief;
  try {
    brief = await loadAgentBrief(supabase, projectId, user.id);
  } catch (err) {
    await refundCredits();
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load book context' },
      { status: 500 },
    );
  }

  // Look up the outline key points for this chapter (if outline exists)
  const outlineChapters = ((brief as any).outline_data?.chapters as any[]) ?? [];
  const matchingOutline = outlineChapters.find((c: any) =>
    c.title === chapter.title || `Chapter ${c.number}: ${c.title}` === chapter.title
  );

  const systemPrompt = `You are the writing agent for a publishing platform. You are rewriting a single chapter of a book. The rewrite must:

1. Preserve the chapter's role in the overall book (keep it consistent with the outline and adjacent chapters)
2. Keep the author's voice and target audience exactly the same
3. Address any specific instructions the author has given for this regeneration
4. Write 3,000–5,000 words of substantive prose — no filler, no generic AI transitions
5. Include concrete examples, specific details, and a clear throughline
6. Avoid phrases like "In conclusion", "Let's dive in", "In today's fast-paced world", "It's worth noting that", "At the end of the day"

Output ONLY the chapter prose. Do not include meta-commentary, a preamble, or a title line.`;

  const userPrompt = `Rewrite this chapter.

${formatBriefForPrompt(brief)}

## Current Chapter
Title: ${chapter.title}
Position: Chapter ${chapter.order_index + 1}

${matchingOutline ? `## Outline Blueprint For This Chapter
Description: ${matchingOutline.description}
Key points to cover:
${(matchingOutline.keyPoints || []).map((kp: string) => `- ${kp}`).join('\n')}
Target length: ${matchingOutline.estimatedWords || 4000} words` : ''}

## Previous Version (for reference — do NOT simply paraphrase)
${(chapter.content || '').slice(0, 4000)}${chapter.content && chapter.content.length > 4000 ? '\n\n[truncated]' : ''}

${instructions ? `## Author Instructions For This Rewrite
${instructions}` : ''}

Rewrite the chapter now.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: modelFor('write_chapter'),
      max_tokens: maxTokensFor('write_chapter'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    await refundCredits();
    console.error('Chapter regeneration API error:', err);
    return NextResponse.json({ error: 'AI call failed, credits refunded' }, { status: 500 });
  }

  const newContent = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');

  if (!newContent || newContent.trim().length < 500) {
    await refundCredits();
    return NextResponse.json({ error: 'Regeneration produced too little content, credits refunded' }, { status: 500 });
  }

  const wordCount = newContent.trim().split(/\s+/).filter(Boolean).length;
  const regenerationCount = (((chapter.metadata as any)?.regenerationCount) ?? 0) + 1;

  // Update chapter
  const { error: updateErr } = await supabase
    .from('chapters')
    .update({
      content: newContent,
      word_count: wordCount,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(chapter.metadata as any),
        regeneratedAt: new Date().toISOString(),
        regenerationCount,
        lastRegenerationModel: modelFor('write_chapter'),
        lastInstructions: instructions || null,
      },
    })
    .eq('id', chapterId);

  if (updateErr) {
    await refundCredits();
    return NextResponse.json({ error: 'Failed to save regenerated chapter' }, { status: 500 });
  }

  // Log the regeneration (best-effort)
  try {
    await supabase.from('chapter_regenerations').insert({
      chapter_id: chapterId,
      project_id: projectId,
      credits_used: profile.is_admin ? 0 : cost,
    });
  } catch {
    // non-fatal
  }

  try {
    if (!profile.is_admin) {
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: -cost,
        transaction_type: 'book_generation',
        notes: `Chapter regeneration: ${chapter.title}`,
      });
    }
  } catch {
    // non-fatal
  }

  try {
    await supabase.from('usage').insert({
      user_id: user.id,
      action_type: 'chapter_regenerate',
      tokens_input: response.usage.input_tokens,
      tokens_output: response.usage.output_tokens,
      model: modelFor('write_chapter'),
      cost_usd: calculateCost('write_chapter', response.usage.input_tokens, response.usage.output_tokens),
      metadata: { projectId, chapterId, regenerationCount },
    });
  } catch {
    // usage table optional
  }

  return NextResponse.json({
    success: true,
    chapter: {
      id: chapterId,
      title: chapter.title,
      content: newContent,
      word_count: wordCount,
      regenerationCount,
    },
    creditsUsed: profile.is_admin ? 0 : cost,
    creditsRemaining: profile.is_admin
      ? totalCredits
      : newBalance + newPurchased,
  });
}
