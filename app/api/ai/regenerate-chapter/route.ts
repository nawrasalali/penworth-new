import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt } from '@/lib/ai/agent-brief';
import { CREDIT_COSTS } from '@/types/agent-workflow';
import { shouldDeductCreditsForProject } from '@/lib/projects/should-deduct-credits';
import { logAuditFromRequest } from '@/lib/audit';

export const maxDuration = 300;

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

  // Phase 1E: project may be showcase-grant-billed, in which case chapter
  // regeneration is also free (the grant waives per-project credit spend).
  const deductCredits = await shouldDeductCreditsForProject(supabase, projectId);

  const totalCredits = (profile.credits_balance || 0) + (profile.credits_purchased || 0);
  if (deductCredits && totalCredits < cost && !profile.is_admin) {
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
  if (deductCredits && !profile.is_admin) {
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

  // Helper: refund if the rest of the flow fails.
  // No-op for admins and for grant-billed projects (nothing was debited).
  const refundCredits = async () => {
    if (profile.is_admin || !deductCredits) return;
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
      // Prompt caching — same rationale as write-book.ts. When an
      // author regenerates several chapters in a sitting (a common
      // review workflow), every regen after the first gets a 10×
      // cheaper cache-read on the system prompt. 5-minute TTL
      // comfortably covers a review session.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
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

  // Cache stats — optional, zero when caching isn't exercised.
  const cacheRead = (response.usage as any).cache_read_input_tokens ?? 0;
  const cacheCreation = (response.usage as any).cache_creation_input_tokens ?? 0;

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
    if (profile.is_admin) {
      // no row for admins
    } else if (!deductCredits) {
      // Grant-billed: log an amount=0 row for audit trail.
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: 0,
        transaction_type: 'book_generation',
        reference_id: projectId,
        notes: `Chapter regeneration: ${chapter.title} (grant-billed, no credits deducted)`,
      });
    } else {
      await supabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: -cost,
        transaction_type: 'book_generation',
        reference_id: projectId,
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
      cost_usd: calculateCost(
        'write_chapter',
        response.usage.input_tokens,
        response.usage.output_tokens,
        cacheRead,
        cacheCreation,
      ),
      metadata: {
        projectId,
        chapterId,
        regenerationCount,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
      },
    });
  } catch {
    // usage table optional
  }

  // Audit trail — credit.spend. We treat all three billing branches
  // (admin-free, grant-billed, normal paid) as the same event type with
  // the `billing_type` in metadata to disambiguate. A regen that cost
  // 0 credits because of a showcase grant is still a meaningful event
  // for investor reporting — it's an agent-action at the platform level.
  const billingType = profile.is_admin
    ? 'admin_free'
    : !deductCredits
      ? 'grant_billed'
      : 'credit_spent';
  const creditsCharged = profile.is_admin ? 0 : deductCredits ? cost : 0;

  void logAuditFromRequest(request, {
    actorType: 'user',
    actorUserId: user.id,
    action: 'credit.spend',
    entityType: 'chapter',
    entityId: chapterId,
    before: {
      credits_balance: profile.credits_balance,
      credits_purchased: profile.credits_purchased,
    },
    after: {
      credits_balance: newBalance,
      credits_purchased: newPurchased,
      credits_charged: creditsCharged,
    },
    metadata: {
      project_id: projectId,
      chapter_title: chapter.title,
      regeneration_count: regenerationCount,
      billing_type: billingType,
      model: modelFor('write_chapter'),
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      cost_usd: calculateCost(
        'write_chapter',
        response.usage.input_tokens,
        response.usage.output_tokens,
        cacheRead,
        cacheCreation,
      ),
    },
  });

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
