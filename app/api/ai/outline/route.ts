import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { modelFor, maxTokensFor, calculateCost } from '@/lib/ai/model-router';
import { loadAgentBrief, formatBriefForPrompt, resolveChapterCount } from '@/lib/ai/agent-brief';

const anthropic = new Anthropic();

interface OutlineChapter {
  number: number;
  title: string;
  description: string;
  keyPoints: string[];      // 3-6 bullets the chapter must cover
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

    const chapterCount = resolveChapterCount(brief.followUp.chapters, 10);
    const totalTargetWords = chapterCount * 4000; // rough target: 4k words/chapter average

    // Choose task: initial vs refine
    const task = feedback ? 'outline_refine' : 'outline_generate';

    const systemPrompt = `You are an outline agent for a publishing platform. Your job is to produce a detailed chapter structure — a blueprint the writing agent will use to generate each chapter.

OUTPUT REQUIREMENTS:
- Front matter: Introduction (required). Optionally Preface if the interview suggests the author has a personal origin story.
- Chapters: Exactly ${chapterCount} chapters based on author's preference. Each chapter must:
  * Have a title that is specific and promise-driven (not generic like "Chapter 1: Introduction" — already handled by front matter)
  * Progress logically from chapter N to N+1 (no random ordering)
  * Cover 3-6 key points, each concrete enough that the writing agent can write 500+ words about it
  * Target ~4000 words per chapter (range 3000-5000)
- Back matter: Conclusion (required). Optionally References section if the content type suggests citations.

The structure must directly reflect the interview answers and research. Do NOT output generic filler chapters. Every chapter must earn its place by serving the chosen idea.

${feedback ? `AUTHOR FEEDBACK ON PREVIOUS OUTLINE: ${feedback}\nRevise the outline to address this feedback while preserving what was working.` : ''}

Respond ONLY with valid JSON matching exactly:
{
  "frontMatter": [
    { "title": "Introduction", "description": "<1-2 sentences on what the introduction does>" }
  ],
  "chapters": [
    {
      "number": 1,
      "title": "<specific, promise-driven title>",
      "description": "<2-3 sentence summary of what this chapter delivers>",
      "keyPoints": ["<point 1>", "<point 2>", "<point 3>"],
      "estimatedWords": 4000
    }
  ],
  "backMatter": [
    { "title": "Conclusion", "description": "<1-2 sentences>" }
  ]
}`;

    const userMessage = `Build the outline for this book.

${formatBriefForPrompt(brief)}

Target total: ~${totalTargetWords.toLocaleString()} words across ${chapterCount} chapters.

Produce the outline now.`;

    const message = await anthropic.messages.create({
      model: modelFor(task),
      max_tokens: maxTokensFor(task),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed: {
      frontMatter: Array<{ title: string; description: string }>;
      chapters: OutlineChapter[];
      backMatter: Array<{ title: string; description: string }>;
    };
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json({ error: 'Failed to parse outline response' }, { status: 500 });
    }

    if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters in outline' }, { status: 500 });
    }

    // Flatten into OutlineSection[] for the UI
    const sections: OutlineSectionOut[] = [
      ...parsed.frontMatter.map((fm, i) => ({
        id: `fm-${i}`,
        type: 'front_matter' as const,
        title: fm.title,
        description: fm.description,
        status: 'complete' as const,
      })),
      ...parsed.chapters.map((ch) => ({
        id: `ch-${ch.number}`,
        type: 'chapter' as const,
        title: ch.title.startsWith('Chapter ') ? ch.title : `Chapter ${ch.number}: ${ch.title}`,
        description: ch.description,
        keyPoints: ch.keyPoints,
        estimatedWords: ch.estimatedWords,
        status: 'complete' as const,
      })),
      ...parsed.backMatter.map((bm, i) => ({
        id: `bm-${i}`,
        type: 'back_matter' as const,
        title: bm.title,
        description: bm.description,
        status: 'complete' as const,
      })),
    ];

    // Persist outline into interview_sessions.outline_data
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
            chapters: parsed.chapters,        // preserve full chapter objects with keyPoints for Writing agent
            frontMatter: parsed.frontMatter,
            backMatter: parsed.backMatter,
            generatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionRow.id);
    }

    // Log usage (best-effort)
    const cost = calculateCost(task, message.usage.input_tokens, message.usage.output_tokens);
    try {
      await supabase.from('usage').insert({
        user_id: user.id,
        action_type: task,
        tokens_input: message.usage.input_tokens,
        tokens_output: message.usage.output_tokens,
        model: modelFor(task),
        cost_usd: cost,
        metadata: { projectId, chapterCount: parsed.chapters.length },
      });
    } catch {
      // usage table may not exist yet — non-fatal
    }

    return NextResponse.json({
      sections,
      chapters: parsed.chapters,
      frontMatter: parsed.frontMatter,
      backMatter: parsed.backMatter,
    });
  } catch (error) {
    console.error('Outline error:', error);
    const msg = error instanceof Error ? error.message : 'Outline generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
