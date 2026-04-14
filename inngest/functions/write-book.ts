import { inngest, BookWriteEvent } from '../client';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Book Writing Pipeline - Durable Execution
 * 
 * Each chapter is written as a separate durable step.
 * If a chapter fails, only that chapter is retried - not the entire book.
 * Progress is persisted after each step completes.
 */
export const writeBook = inngest.createFunction(
  {
    id: 'write-book',
    name: 'Write Complete Book',
    retries: 3,
  },
  { event: 'book/write' },
  async ({ event, step }) => {
    const { projectId, userId, title, outline, industry, voiceProfile } = event.data;

    // Step 1: Initialize project status
    await step.run('initialize-project', async () => {
      await supabase
        .from('projects')
        .update({
          status: 'writing',
          metadata: {
            totalChapters: outline.chapters.length,
            completedChapters: 0,
            startedAt: new Date().toISOString(),
          },
        })
        .eq('id', projectId);

      return { initialized: true };
    });

    // Step 2: Write each chapter as a separate durable step
    const writtenChapters: Array<{ chapterId: string; title: string; wordCount: number }> = [];

    for (let i = 0; i < outline.chapters.length; i++) {
      const chapterOutline = outline.chapters[i];
      
      const chapterResult = await step.run(`write-chapter-${i + 1}`, async () => {
        const chapterPrompt = buildChapterPrompt({
          bookTitle: title,
          chapterNumber: i + 1,
          chapterTitle: chapterOutline.title,
          chapterDescription: chapterOutline.description,
          keyPoints: chapterOutline.keyPoints,
          industry,
          voiceProfile,
          previousChaptersSummary: writtenChapters.map(c => c.title).join(', '),
        });

        // Call Claude API for chapter content
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: getSystemPrompt(industry, voiceProfile),
          messages: [{ role: 'user', content: chapterPrompt }],
        });

        const content = response.content
          .filter(block => block.type === 'text')
          .map(block => (block as { type: 'text'; text: string }).text)
          .join('\n');

        const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

        // Save chapter to database
        const { data: chapter, error } = await supabase
          .from('chapters')
          .insert({
            project_id: projectId,
            title: chapterOutline.title,
            content,
            order_index: i,
            status: 'complete',
            word_count: wordCount,
            metadata: {
              generatedAt: new Date().toISOString(),
              model: 'claude-sonnet-4-20250514',
              tokensUsed: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
              },
            },
          })
          .select()
          .single();

        if (error) throw new Error(`Failed to save chapter: ${error.message}`);

        // Update project progress
        await supabase
          .from('projects')
          .update({
            metadata: {
              totalChapters: outline.chapters.length,
              completedChapters: i + 1,
              lastUpdatedAt: new Date().toISOString(),
            },
          })
          .eq('id', projectId);

        // Log AI usage
        await supabase.from('usage').insert({
          user_id: userId,
          action_type: 'chapter_write',
          tokens_input: response.usage.input_tokens,
          tokens_output: response.usage.output_tokens,
          model: 'claude-sonnet-4-20250514',
          cost_usd: calculateCost(response.usage.input_tokens, response.usage.output_tokens),
          metadata: { projectId, chapterId: chapter.id, chapterNumber: i + 1 },
        });

        return {
          chapterId: chapter.id,
          title: chapterOutline.title,
          wordCount,
        };
      });

      writtenChapters.push(chapterResult);
    }

    // Step 3: Finalize book
    const finalResult = await step.run('finalize-book', async () => {
      const totalWordCount = writtenChapters.reduce((sum, ch) => sum + ch.wordCount, 0);

      await supabase
        .from('projects')
        .update({
          status: 'complete',
          metadata: {
            totalChapters: outline.chapters.length,
            completedChapters: outline.chapters.length,
            totalWordCount,
            completedAt: new Date().toISOString(),
          },
        })
        .eq('id', projectId);

      // Check if this is user's first completed book
      const { count: completedBooksCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'complete');

      // If this is the first book, trigger referral credits
      if (completedBooksCount === 1) {
        await triggerReferralCredits(userId, projectId, title);
      }

      return {
        success: true,
        totalChapters: outline.chapters.length,
        totalWordCount,
        chapters: writtenChapters,
        isFirstBook: completedBooksCount === 1,
      };
    });

    return finalResult;
  }
);

/**
 * Give referral credits when a referred user completes their first book
 * Per PLG spec: 500 credits to the referrer
 */
async function triggerReferralCredits(userId: string, projectId: string, bookTitle: string) {
  const REFERRAL_CREDITS = 500;

  try {
    // Check if user was referred by someone
    const { data: referral } = await supabase
      .from('referrals')
      .select('referrer_id, status')
      .eq('referee_id', userId)
      .eq('status', 'pending')
      .single();

    if (!referral) {
      // User wasn't referred or already credited
      return;
    }

    // Update referral status to completed
    await supabase
      .from('referrals')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString(),
        first_book_id: projectId,
      })
      .eq('referee_id', userId);

    // Get referrer's current credits
    const { data: referrerProfile } = await supabase
      .from('profiles')
      .select('credits_balance, credits_purchased')
      .eq('id', referral.referrer_id)
      .single();

    if (!referrerProfile) return;

    // Add credits to purchased (they never expire)
    const newCreditsPurchased = (referrerProfile.credits_purchased || 0) + REFERRAL_CREDITS;

    await supabase
      .from('profiles')
      .update({ credits_purchased: newCreditsPurchased })
      .eq('id', referral.referrer_id);

    // Log the credit transaction
    await supabase.from('credit_transactions').insert({
      user_id: referral.referrer_id,
      amount: REFERRAL_CREDITS,
      type: 'referral_bonus',
      description: `Referral bonus: Friend completed their first book "${bookTitle}"`,
      metadata: { 
        refereeId: userId, 
        projectId,
        bookTitle,
      },
    });

    // Get referrer email to send notification
    const { data: referrerData } = await supabase.auth.admin.getUserById(referral.referrer_id);
    
    if (referrerData?.user?.email) {
      // TODO: Send email notification via Resend
      console.log(`Referral credits notification to send to: ${referrerData.user.email}`);
    }

  } catch (error) {
    console.error('Error triggering referral credits:', error);
    // Don't throw - book completion should succeed even if referral fails
  }
}

// Helper: Build chapter writing prompt
function buildChapterPrompt(params: {
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterDescription: string;
  keyPoints: string[];
  industry: string;
  voiceProfile?: { tone: string; style: string; vocabulary: string };
  previousChaptersSummary: string;
}): string {
  const {
    bookTitle,
    chapterNumber,
    chapterTitle,
    chapterDescription,
    keyPoints,
    voiceProfile,
    previousChaptersSummary,
  } = params;

  return `Write Chapter ${chapterNumber} of the book "${bookTitle}".

## Chapter Information
- **Title:** ${chapterTitle}
- **Description:** ${chapterDescription}
- **Key Points to Cover:**
${keyPoints.map(point => `  - ${point}`).join('\n')}

${previousChaptersSummary ? `## Previous Chapters: ${previousChaptersSummary}` : ''}

${voiceProfile ? `## Voice Profile
- **Tone:** ${voiceProfile.tone}
- **Style:** ${voiceProfile.style}
- **Vocabulary:** ${voiceProfile.vocabulary}` : ''}

## Requirements
1. Write approximately 3,000-5,000 words
2. Cover all key points thoroughly
3. Use clear section headings
4. Include practical examples where appropriate
5. Maintain consistent voice throughout
6. End with a natural transition to the next chapter (if not the final chapter)

Write the complete chapter content now:`;
}

// Helper: Get system prompt based on industry
function getSystemPrompt(industry: string, voiceProfile?: { tone: string; style: string; vocabulary: string }): string {
  const basePrompt = `You are an expert author and content creator specializing in ${industry}. You write clear, engaging, and authoritative content that serves the reader's needs.

Your writing should be:
- Professional yet accessible
- Well-structured with clear headings and sections
- Rich with practical examples and actionable insights
- Free from filler content or unnecessary repetition
- Properly formatted for publication`;

  if (voiceProfile) {
    return `${basePrompt}

Specific voice guidelines:
- Tone: ${voiceProfile.tone}
- Style: ${voiceProfile.style}
- Vocabulary: ${voiceProfile.vocabulary}`;
  }

  return basePrompt;
}

// Helper: Calculate AI cost
function calculateCost(inputTokens: number, outputTokens: number): number {
  // Claude Sonnet pricing as of 2026
  const inputCost = (inputTokens / 1_000_000) * 3.00;
  const outputCost = (outputTokens / 1_000_000) * 15.00;
  return Number((inputCost + outputCost).toFixed(6));
}

export default writeBook;
