import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';

const anthropic = new Anthropic();

export interface QACheck {
  name: string;
  status: 'pending' | 'checking' | 'passed' | 'warning' | 'failed';
  detail?: string;
}

/**
 * Heuristic Flesch Reading Ease (0-100, higher = easier).
 */
function fleschReadingEase(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length || 1;
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllableCount / wordCount);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length <= 3) return 1;
  const vowelGroups = clean.replace(/e$/, '').match(/[aeiouy]+/g);
  return vowelGroups ? vowelGroups.length : 1;
}

/**
 * Detect common AI filler phrases that indicate bland generic writing.
 */
function detectAiArtifacts(text: string): string[] {
  const patterns = [
    /\bin conclusion\b/gi,
    /\blet'?s dive in\b/gi,
    /\bin today'?s (fast-paced |rapidly changing |modern )?world\b/gi,
    /\bat the end of the day\b/gi,
    /\bit'?s worth noting that\b/gi,
    /\bas we (all )?know\b/gi,
    /\bit goes without saying\b/gi,
    /\bwhether you'?re\b/gi,
  ];
  const found: string[] = [];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) found.push(`"${matches[0]}" (${matches.length}×)`);
  }
  return found;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { projectId } = await request.json();
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    // Verify ownership + load chapters
    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .select('id, user_id, title, content_type')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: chapters } = await supabase
      .from('chapters')
      .select('id, title, content, word_count, order_index')
      .eq('project_id', projectId)
      .order('order_index');

    if (!chapters || chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters to check' }, { status: 400 });
    }

    const checks: QACheck[] = [];

    // === CHECK 1: Word count bounds (deterministic) ===
    const lowCountChapters = chapters.filter((ch) => (ch.word_count ?? 0) < 1500);
    const highCountChapters = chapters.filter((ch) => (ch.word_count ?? 0) > 7000);
    if (lowCountChapters.length === 0 && highCountChapters.length === 0) {
      checks.push({ name: 'Chapter word count', status: 'passed', detail: `All ${chapters.length} chapters within target (1,500–7,000 words)` });
    } else if (lowCountChapters.length > 0) {
      checks.push({
        name: 'Chapter word count',
        status: 'warning',
        detail: `${lowCountChapters.length} chapter(s) under 1,500 words: ${lowCountChapters.map((c) => c.title).join(', ')}`,
      });
    } else {
      checks.push({
        name: 'Chapter word count',
        status: 'warning',
        detail: `${highCountChapters.length} chapter(s) over 7,000 words may need trimming`,
      });
    }

    // === CHECK 2: AI filler detection (deterministic) ===
    const allContent = chapters.map((ch) => ch.content || '').join('\n\n');
    const artifacts = detectAiArtifacts(allContent);
    checks.push({
      name: 'AI filler phrases',
      status: artifacts.length === 0 ? 'passed' : artifacts.length <= 3 ? 'warning' : 'failed',
      detail: artifacts.length === 0
        ? 'No common AI filler phrases detected'
        : `Found: ${artifacts.slice(0, 5).join(', ')}`,
    });

    // === CHECK 3: Readability (deterministic, Flesch) ===
    const readability = fleschReadingEase(allContent);
    checks.push({
      name: 'Readability (Flesch)',
      status: readability >= 50 ? 'passed' : readability >= 30 ? 'warning' : 'failed',
      detail: `Score ${readability}/100 — ${
        readability >= 60 ? 'easy to read' :
        readability >= 50 ? 'plain English' :
        readability >= 30 ? 'fairly difficult' : 'very difficult'
      }`,
    });

    // === CHECK 4: Haiku tone + readability review ===
    const toneSample = allContent.slice(0, 4000);
    const tonePrompt = `You are a QA agent checking the tonal consistency of book content. Read this excerpt and respond ONLY with JSON:
{
  "consistent": true | false,
  "observation": "<one sentence>"
}

Excerpt:
${toneSample}`;
    try {
      const toneResp = await anthropic.messages.create({
        model: modelFor('qa_readability'),
        max_tokens: maxTokensFor('qa_readability'),
        messages: [{ role: 'user', content: tonePrompt }],
      });
      const toneText = toneResp.content[0].type === 'text' ? toneResp.content[0].text : '';
      const toneClean = toneText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const toneResult = JSON.parse(toneClean) as { consistent: boolean; observation: string };
      checks.push({
        name: 'Tonal consistency',
        status: toneResult.consistent ? 'passed' : 'warning',
        detail: toneResult.observation,
      });

      // Log cost
      try {
        await supabase.from('usage').insert({
          user_id: user.id,
          action_type: 'qa_readability',
          tokens_input: toneResp.usage.input_tokens,
          tokens_output: toneResp.usage.output_tokens,
          model: modelFor('qa_readability'),
          cost_usd: calculateCost('qa_readability', toneResp.usage.input_tokens, toneResp.usage.output_tokens),
          metadata: { projectId },
        });
      } catch {
        // usage table optional
      }
    } catch (err) {
      checks.push({ name: 'Tonal consistency', status: 'warning', detail: 'Could not run tonal check' });
    }

    // === CHECK 5: Sonnet coherence review (cross-chapter) ===
    const chapterSummaries = chapters
      .map((ch, i) => `Chapter ${i + 1}: ${ch.title}\n${(ch.content || '').slice(0, 500)}...`)
      .join('\n\n---\n\n')
      .slice(0, 12000);

    const coherencePrompt = `You are a QA agent checking cross-chapter coherence for a book titled "${project.title}". Read these chapter openings and respond ONLY with JSON:
{
  "coherent": true | false,
  "issues": ["<specific issue>", ...]
}

Chapters:
${chapterSummaries}

Look for: contradictions between chapters, abrupt topic jumps, missing throughlines, duplicated content.`;
    try {
      const cohResp = await anthropic.messages.create({
        model: modelFor('qa_coherence'),
        max_tokens: maxTokensFor('qa_coherence'),
        messages: [{ role: 'user', content: coherencePrompt }],
      });
      const cohText = cohResp.content[0].type === 'text' ? cohResp.content[0].text : '';
      const cohClean = cohText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const cohResult = JSON.parse(cohClean) as { coherent: boolean; issues: string[] };
      checks.push({
        name: 'Cross-chapter coherence',
        status: cohResult.coherent ? 'passed' : 'warning',
        detail: cohResult.coherent
          ? 'Chapters flow together consistently'
          : `Issues: ${cohResult.issues.slice(0, 3).join('; ')}`,
      });

      try {
        await supabase.from('usage').insert({
          user_id: user.id,
          action_type: 'qa_coherence',
          tokens_input: cohResp.usage.input_tokens,
          tokens_output: cohResp.usage.output_tokens,
          model: modelFor('qa_coherence'),
          cost_usd: calculateCost('qa_coherence', cohResp.usage.input_tokens, cohResp.usage.output_tokens),
          metadata: { projectId },
        });
      } catch { /* optional */ }
    } catch (err) {
      checks.push({ name: 'Cross-chapter coherence', status: 'warning', detail: 'Could not run coherence check' });
    }

    // === CHECK 6: Structural completeness (deterministic) ===
    const hasMinChapters = chapters.length >= 3;
    checks.push({
      name: 'Structural completeness',
      status: hasMinChapters ? 'passed' : 'failed',
      detail: hasMinChapters
        ? `${chapters.length} chapters, ${chapters.reduce((s, c) => s + (c.word_count ?? 0), 0).toLocaleString()} total words`
        : 'Need at least 3 chapters',
    });

    // Persist QA summary into session
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
          qa_data: {
            checks,
            completedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionRow.id);
    }

    return NextResponse.json({ checks });
  } catch (error) {
    console.error('QA error:', error);
    const msg = error instanceof Error ? error.message : 'QA failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
