/**
 * Penworth Interview Agent System
 * 
 * A comprehensive AI-powered interview system that:
 * 1. Validates book ideas with market-based scoring
 * 2. Offers alternative/better ideas with reasoning
 * 3. Conducts structured interviews with open-ended + multiple choice questions
 * 4. Supports file uploads (drafts, images, research)
 * 5. Allows save & stop or stop to progress
 * 6. Generates follow-up questions before next agent
 */

import { ContentType } from '@/types';

// =============================================================================
// IDEA VALIDATION SYSTEM
// =============================================================================

export interface IdeaValidationCriteria {
  category: string;
  weight: number; // 0-1
  description: string;
  scoringGuide: string;
}

export const IDEA_VALIDATION_CRITERIA: IdeaValidationCriteria[] = [
  {
    category: 'Market Demand',
    weight: 0.20,
    description: 'Is there proven demand for this topic?',
    scoringGuide: `
      9-10: Trending topic with massive search volume, existing bestsellers
      7-8: Strong niche with consistent demand, proven audience
      5-6: Moderate interest, some competition but not saturated
      3-4: Limited demand, very niche audience
      1-2: No apparent market demand, oversaturated, or dying topic
    `
  },
  {
    category: 'Target Audience Clarity',
    weight: 0.15,
    description: 'How well-defined is the target reader?',
    scoringGuide: `
      9-10: Crystal clear demographic, psychographic, and buying behavior
      7-8: Good understanding of who will buy and why
      5-6: General sense of audience but vague
      3-4: Unclear who would actually buy this
      1-2: No identifiable target audience
    `
  },
  {
    category: 'Unique Value Proposition',
    weight: 0.20,
    description: 'What makes this different from existing books?',
    scoringGuide: `
      9-10: Truly unique angle, no direct competition, first-mover advantage
      7-8: Clear differentiation, better approach than competitors
      5-6: Some unique elements but similar books exist
      3-4: Me-too product with minimal differentiation
      1-2: Identical to existing offerings, no unique value
    `
  },
  {
    category: 'Author Credibility',
    weight: 0.15,
    description: 'Does the author have relevant expertise or platform?',
    scoringGuide: `
      9-10: World-renowned expert, massive following, proven track record
      7-8: Recognized professional, established platform, relevant credentials
      5-6: Some expertise or platform, building credibility
      3-4: Limited expertise, no platform yet
      1-2: No relevant expertise or platform
    `
  },
  {
    category: 'Commercial Viability',
    weight: 0.15,
    description: 'Can this book generate revenue?',
    scoringGuide: `
      9-10: Multiple revenue streams (courses, speaking, consulting), premium pricing
      7-8: Strong sales potential, upsell opportunities
      5-6: Decent sales potential, standard pricing
      3-4: Limited commercial appeal, low price point necessary
      1-2: No clear path to revenue
    `
  },
  {
    category: 'Execution Feasibility',
    weight: 0.15,
    description: 'Can this book realistically be completed?',
    scoringGuide: `
      9-10: Author has all resources, time, and ability to complete quickly
      7-8: Good resources, realistic timeline
      5-6: Moderate challenges but achievable
      3-4: Significant obstacles to completion
      1-2: Unrealistic scope or resources
    `
  }
];

export const IDEA_VALIDATION_PROMPT = `You are Penworth's Idea Validation Agent. Your role is to help authors make informed decisions about their book ideas BEFORE they invest significant time and resources.

<validation_criteria>
${IDEA_VALIDATION_CRITERIA.map(c => `
## ${c.category} (Weight: ${c.weight * 100}%)
${c.description}
${c.scoringGuide}
`).join('\n')}
</validation_criteria>

<validation_process>
1. UNDERSTAND THE IDEA
   - Ask clarifying questions about the book concept
   - Understand the author's goals and motivations
   - Identify the target audience and unique angle

2. SCORE EACH CRITERION
   - Evaluate against each criterion (1-10)
   - Provide specific reasoning for each score
   - Calculate weighted total score

3. PROVIDE VERDICT
   - Score 80-100: STRONG - Proceed with confidence
   - Score 60-79: PROMISING - Address weaknesses first
   - Score 40-59: RISKY - Significant pivots needed
   - Score 0-39: RECONSIDER - Major changes or new idea recommended

4. OFFER ALTERNATIVES
   - If score < 70, suggest 2-3 better alternative angles
   - Explain WHY each alternative would score higher
   - Be specific and actionable

5. REVALIDATION
   - After suggesting alternatives, offer to re-score the chosen direction
   - Help author iterate until they have a viable concept
</validation_process>

<output_format>
When providing your validation, use this structure:

## 📊 Idea Validation Score: [TOTAL]/100

### Breakdown:
| Criterion | Score | Weighted | Notes |
|-----------|-------|----------|-------|
| Market Demand | X/10 | X.X | [brief note] |
| Target Audience | X/10 | X.X | [brief note] |
| Unique Value | X/10 | X.X | [brief note] |
| Author Credibility | X/10 | X.X | [brief note] |
| Commercial Viability | X/10 | X.X | [brief note] |
| Execution Feasibility | X/10 | X.X | [brief note] |

### Verdict: [STRONG/PROMISING/RISKY/RECONSIDER]
[2-3 sentence summary of key findings]

### Key Strengths:
- [strength 1]
- [strength 2]

### Critical Weaknesses:
- [weakness 1 with specific recommendation]
- [weakness 2 with specific recommendation]

### Alternative Approaches (if needed):
1. **[Alternative Title/Angle]** (Estimated Score: XX)
   - Why it's better: [specific reasons]
   
2. **[Alternative Title/Angle]** (Estimated Score: XX)
   - Why it's better: [specific reasons]

---
Would you like me to:
A) Deep dive into any criterion
B) Revalidate with a modified approach
C) Proceed to interview with your chosen idea
</output_format>

<guidelines>
- Be HONEST but constructive - authors need truth, not false encouragement
- Use market data and publishing knowledge to inform scores
- Always explain the "why" behind scores
- Make alternatives genuinely better, not just different
- Remember: A pivoted idea that succeeds > A beloved idea that fails
</guidelines>`;

// =============================================================================
// INTERVIEWER AGENT SYSTEM
// =============================================================================

export interface InterviewQuestion {
  id: string;
  phase: 'foundation' | 'content' | 'audience' | 'structure' | 'style' | 'logistics';
  question: string;
  type: 'open' | 'multiple_choice' | 'scale' | 'yes_no';
  options?: string[]; // For multiple choice, always include "Something else..." as last option
  followUp?: string; // Question to ask if they choose "Something else..."
  required: boolean;
  helpText?: string;
}

export const INTERVIEW_QUESTIONS: Record<ContentType, InterviewQuestion[]> = {
  'non-fiction': [
    // FOUNDATION PHASE
    {
      id: 'nf_core_message',
      phase: 'foundation',
      question: 'In one sentence, what is the single most important message or transformation you want readers to take away from your book?',
      type: 'open',
      required: true,
      helpText: 'This becomes your "north star" - every chapter should support this core message.'
    },
    {
      id: 'nf_why_now',
      phase: 'foundation',
      question: 'Why is NOW the right time for this book? What makes it urgent or timely?',
      type: 'multiple_choice',
      options: [
        'Industry/market shift happening right now',
        'New research or data just became available',
        'Cultural/social changes making this relevant',
        'Personal milestone or breakthrough to share',
        'Gap in existing literature I\'ve identified',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_author_journey',
      phase: 'foundation',
      question: 'Tell me about YOUR journey with this topic. What personal experiences or expertise make you the right person to write this?',
      type: 'open',
      required: true,
      helpText: 'Stories and personal experiences make non-fiction compelling and credible.'
    },
    
    // AUDIENCE PHASE
    {
      id: 'nf_reader_profile',
      phase: 'audience',
      question: 'Describe your ideal reader in detail. Who are they, what do they do, and what keeps them up at night?',
      type: 'open',
      required: true
    },
    {
      id: 'nf_reader_level',
      phase: 'audience',
      question: 'What is your reader\'s current knowledge level on this topic?',
      type: 'multiple_choice',
      options: [
        'Complete beginner - never heard of this before',
        'Curious newcomer - heard about it, wants to learn',
        'Intermediate - knows basics, wants to go deeper',
        'Advanced - significant knowledge, wants mastery',
        'Expert - wants cutting-edge/specialized content',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_reader_pain',
      phase: 'audience',
      question: 'What specific problem or pain point will your book solve for readers? Be as concrete as possible.',
      type: 'open',
      required: true
    },
    {
      id: 'nf_reader_transformation',
      phase: 'audience',
      question: 'After reading your book, how will your reader be different? What will they be able to DO that they couldn\'t before?',
      type: 'open',
      required: true
    },
    
    // CONTENT PHASE
    {
      id: 'nf_key_concepts',
      phase: 'content',
      question: 'What are the 3-5 key concepts, frameworks, or ideas that form the backbone of your book?',
      type: 'open',
      required: true,
      helpText: 'These often become your main chapters or sections.'
    },
    {
      id: 'nf_existing_content',
      phase: 'content',
      question: 'Do you have any existing content we should incorporate?',
      type: 'multiple_choice',
      options: [
        'Yes - blog posts, articles, or essays',
        'Yes - presentations, speeches, or workshops',
        'Yes - research, data, or case studies',
        'Yes - previous book drafts or outlines',
        'No - starting completely fresh',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_stories',
      phase: 'content',
      question: 'What stories, case studies, or examples do you want to include? (List at least 3 if possible)',
      type: 'open',
      required: false,
      helpText: 'Stories are the "proof" that makes your concepts believable and memorable.'
    },
    {
      id: 'nf_controversial',
      phase: 'content',
      question: 'Is there anything controversial or contrarian in your book? What will make people say "I never thought of it that way"?',
      type: 'open',
      required: false
    },
    
    // STRUCTURE PHASE
    {
      id: 'nf_structure_pref',
      phase: 'structure',
      question: 'How should your book be organized?',
      type: 'multiple_choice',
      options: [
        'Step-by-step process (do this, then this, then this)',
        'Framework/model (here\'s my system with components)',
        'Principles-based (here are the key principles)',
        'Chronological/journey (follow my story/timeline)',
        'Problem-solution pairs (problem 1 → solution 1, etc.)',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_length',
      phase: 'structure',
      question: 'What length are you targeting?',
      type: 'multiple_choice',
      options: [
        'Short & punchy (20,000-30,000 words) - quick read',
        'Standard non-fiction (40,000-60,000 words) - typical business book',
        'Comprehensive (60,000-80,000 words) - detailed guide',
        'Definitive reference (80,000+ words) - exhaustive coverage',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_chapter_elements',
      phase: 'structure',
      question: 'What elements should each chapter include?',
      type: 'multiple_choice',
      options: [
        'Opening hook + content + key takeaways',
        'Story + lesson + action steps',
        'Problem + solution + examples + exercises',
        'Concept + framework + case studies + summary',
        'Something else...'
      ],
      required: true
    },
    
    // STYLE PHASE
    {
      id: 'nf_tone',
      phase: 'style',
      question: 'What tone should your book have?',
      type: 'multiple_choice',
      options: [
        'Authoritative & professional',
        'Warm & conversational',
        'Direct & no-nonsense',
        'Inspiring & motivational',
        'Academic & research-backed',
        'Witty & entertaining',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_similar_books',
      phase: 'style',
      question: 'Name 2-3 books whose style, tone, or approach you admire and want to emulate.',
      type: 'open',
      required: false
    },
    
    // LOGISTICS PHASE
    {
      id: 'nf_timeline',
      phase: 'logistics',
      question: 'What\'s your target timeline for completion?',
      type: 'multiple_choice',
      options: [
        'ASAP - I have a deadline',
        '3-6 months',
        '6-12 months',
        'No rush - quality over speed',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'nf_publishing_goal',
      phase: 'logistics',
      question: 'What\'s your publishing goal?',
      type: 'multiple_choice',
      options: [
        'Traditional publishing (agent → publisher)',
        'Self-publishing (Amazon KDP, IngramSpark)',
        'Hybrid publishing',
        'Not sure yet - need guidance',
        'Something else...'
      ],
      required: true
    }
  ],
  
  'fiction': [
    // FOUNDATION PHASE
    {
      id: 'f_logline',
      phase: 'foundation',
      question: 'Describe your story in 1-2 sentences (the "logline"). Who is the protagonist, what do they want, and what stands in their way?',
      type: 'open',
      required: true,
      helpText: 'Example: "A young wizard discovers he\'s destined to defeat the dark lord who killed his parents, but first must learn to control powers he never knew he had."'
    },
    {
      id: 'f_genre',
      phase: 'foundation',
      question: 'What genre and sub-genre is your book?',
      type: 'multiple_choice',
      options: [
        'Literary Fiction',
        'Thriller/Suspense',
        'Mystery/Crime',
        'Romance',
        'Science Fiction',
        'Fantasy',
        'Horror',
        'Historical Fiction',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'f_theme',
      phase: 'foundation',
      question: 'What is the deeper theme or message of your story? What truth about human nature or life are you exploring?',
      type: 'open',
      required: true
    },
    
    // CHARACTER PHASE
    {
      id: 'f_protagonist',
      phase: 'content',
      question: 'Tell me about your protagonist. Who are they at the START of the story? What are their strengths, flaws, and fears?',
      type: 'open',
      required: true
    },
    {
      id: 'f_protagonist_arc',
      phase: 'content',
      question: 'How does your protagonist change by the END of the story? What do they learn or overcome?',
      type: 'open',
      required: true
    },
    {
      id: 'f_antagonist',
      phase: 'content',
      question: 'Who or what is the antagonist/opposition? What makes them a formidable obstacle?',
      type: 'open',
      required: true
    },
    {
      id: 'f_supporting',
      phase: 'content',
      question: 'Who are the key supporting characters? What role does each play in the protagonist\'s journey?',
      type: 'open',
      required: false
    },
    
    // PLOT PHASE
    {
      id: 'f_structure',
      phase: 'structure',
      question: 'What story structure do you want to follow?',
      type: 'multiple_choice',
      options: [
        'Three-act structure (setup, confrontation, resolution)',
        'Hero\'s Journey (Campbell\'s monomyth)',
        'Seven-point structure',
        'Save the Cat beats',
        'Non-linear/experimental',
        'Not sure - need help choosing',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'f_opening',
      phase: 'structure',
      question: 'Where does your story begin? What\'s the "hook" that pulls readers in?',
      type: 'open',
      required: true
    },
    {
      id: 'f_climax',
      phase: 'structure',
      question: 'What is the climactic moment of your story? What\'s at stake?',
      type: 'open',
      required: true
    },
    {
      id: 'f_subplots',
      phase: 'structure',
      question: 'What subplots will weave through your main story?',
      type: 'open',
      required: false
    },
    
    // WORLD/SETTING PHASE
    {
      id: 'f_setting',
      phase: 'content',
      question: 'Describe the world/setting of your story. When and where does it take place?',
      type: 'open',
      required: true
    },
    {
      id: 'f_world_rules',
      phase: 'content',
      question: 'What special rules or elements exist in your world? (Magic systems, technology, social structures, etc.)',
      type: 'open',
      required: false,
      helpText: 'Especially important for fantasy, sci-fi, and speculative fiction.'
    },
    
    // STYLE PHASE
    {
      id: 'f_pov',
      phase: 'style',
      question: 'What point of view will you use?',
      type: 'multiple_choice',
      options: [
        'First person - single narrator',
        'First person - multiple narrators',
        'Third person limited - single POV',
        'Third person limited - multiple POVs',
        'Third person omniscient',
        'Second person',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'f_tense',
      phase: 'style',
      question: 'What tense will you write in?',
      type: 'multiple_choice',
      options: [
        'Past tense (most common)',
        'Present tense',
        'Mixed/varies by section',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'f_comp_titles',
      phase: 'style',
      question: 'What are your "comp titles" - published books your novel is similar to in tone, style, or content?',
      type: 'open',
      required: false,
      helpText: 'Think: "It\'s like [Book A] meets [Book B]"'
    },
    
    // LOGISTICS PHASE
    {
      id: 'f_length',
      phase: 'logistics',
      question: 'What length are you targeting?',
      type: 'multiple_choice',
      options: [
        'Novella (20,000-40,000 words)',
        'Short novel (50,000-70,000 words)',
        'Standard novel (70,000-90,000 words)',
        'Epic/long novel (100,000+ words)',
        'Something else...'
      ],
      required: true
    },
    {
      id: 'f_existing_draft',
      phase: 'logistics',
      question: 'Do you have any existing draft or outline?',
      type: 'multiple_choice',
      options: [
        'Yes - complete first draft',
        'Yes - partial draft',
        'Yes - detailed outline',
        'Yes - rough notes/scenes',
        'No - starting fresh',
        'Something else...'
      ],
      required: true
    }
  ],
  
  // DEFAULT QUESTIONS FOR OTHER CONTENT TYPES
  'business': [],
  'memoir': [],
  'self-help': [],
  'technical': [],
  'academic': [],
  'children': [],
  'poetry': [],
  'cookbook': [],
  'travel': [],
  'biography': [],
  'other': [],
  'book': [],
  'paper': [],
  'business_plan': [],
  'financial_model': [],
  'educational': [],
  'policy': [],
  'technical_doc': [],
  'report': []
};

// Fill in default questions for content types that don't have specific ones
const DEFAULT_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'default_purpose',
    phase: 'foundation',
    question: 'What is the primary purpose of this document? What should readers be able to do or understand after reading it?',
    type: 'open',
    required: true
  },
  {
    id: 'default_audience',
    phase: 'audience',
    question: 'Who is the target audience for this document?',
    type: 'open',
    required: true
  },
  {
    id: 'default_key_points',
    phase: 'content',
    question: 'What are the 3-5 most important points or topics that MUST be included?',
    type: 'open',
    required: true
  },
  {
    id: 'default_tone',
    phase: 'style',
    question: 'What tone should this document have?',
    type: 'multiple_choice',
    options: [
      'Formal and professional',
      'Casual and conversational',
      'Technical and precise',
      'Inspirational and motivating',
      'Something else...'
    ],
    required: true
  },
  {
    id: 'default_length',
    phase: 'logistics',
    question: 'How long should this document be?',
    type: 'multiple_choice',
    options: [
      'Brief (under 5 pages)',
      'Standard (5-20 pages)',
      'Comprehensive (20-50 pages)',
      'Extensive (50+ pages)',
      'Something else...'
    ],
    required: true
  }
];

// Apply default questions to empty content types
Object.keys(INTERVIEW_QUESTIONS).forEach(key => {
  if (INTERVIEW_QUESTIONS[key as ContentType].length === 0) {
    INTERVIEW_QUESTIONS[key as ContentType] = DEFAULT_QUESTIONS;
  }
});

export const INTERVIEWER_PROMPT = `You are Penworth's Expert Interviewer Agent. Your job is to conduct a thorough, engaging interview to gather ALL the information needed to create an exceptional document.

<interviewer_persona>
You are like the best developmental editor and writing coach combined:
- Warm, encouraging, and genuinely curious about the author's vision
- Sharp enough to ask probing follow-up questions
- Skilled at helping authors articulate what they know but haven't put into words
- Patient with beginners, challenging with experts
</interviewer_persona>

<interview_approach>
1. START WITH ENTHUSIASM
   - Acknowledge their idea and express genuine interest
   - Make them feel their project matters

2. ASK ONE QUESTION AT A TIME
   - Don't overwhelm with multiple questions
   - Wait for their answer before moving on
   - For multiple choice: ALWAYS include the options AND "Something else..." option

3. FOLLOW UP SMARTLY
   - If answer is vague, ask for specifics
   - If answer is interesting, explore deeper
   - Use "Can you tell me more about..." or "What do you mean by..."

4. VALIDATE AND SUMMARIZE
   - After each major section, summarize what you've learned
   - Confirm you've understood correctly

5. SUPPORT FILE UPLOADS
   - When relevant, invite them to upload existing drafts, images, research
   - Example: "Do you have any existing content—drafts, outlines, images, or research—that would help me understand your vision better? You can upload files here."

6. OFFER SAVE POINTS
   - After each phase, offer: "Great progress! Would you like to:
     A) Continue to the next section
     B) Save and continue later
     C) Review what we've covered so far"
</interview_approach>

<question_format>
For MULTIPLE CHOICE questions, always format like this:

"[Question text]

Please choose one:
1. [Option A]
2. [Option B]
3. [Option C]
4. [Option D]
5. Something else... (please describe)

Which resonates most with you?"

For OPEN-ENDED questions:
"[Question text]

[Optional help text in italics]

Take your time with this one—the more detail you share, the better I can help shape your [book/document]."

For SCALE questions:
"On a scale of 1-10, [question]?
(1 = [low end], 10 = [high end])"
</question_format>

<phase_transitions>
When moving between interview phases, use transitions like:

"Excellent! Now I have a clear picture of [what we covered]. Let's talk about [next phase]..."

"That's really helpful. Now let's shift gears and discuss [next phase]..."

"Perfect. The foundation is solid. Time to dive into [next phase]..."
</phase_transitions>

<handling_responses>
- If they choose "Something else...": "Interesting! Tell me more about that..."
- If they're unsure: "No problem! Let me break this down..." [offer simpler options]
- If they want to skip: "Totally fine to come back to this. Let's move on to..."
- If they upload a file: "Thanks for sharing this! Let me review it... [analyze and reference specific elements]"
</handling_responses>

<interview_completion>
When all questions are answered:

"🎉 Interview Complete!

Here's a summary of what we've gathered:

**[Document Type]: [Title/Concept]**

**Core Vision:** [1-2 sentence summary]

**Target Audience:** [Who this is for]

**Key Themes/Topics:**
- [Theme 1]
- [Theme 2]
- [Theme 3]

**Structure:** [How it will be organized]

**Tone:** [Voice and style]

**Length:** [Target word count/pages]

---

**Before we move to the outline phase, here are a few follow-up questions:**

1. [Strategic follow-up question]
   Suggested answers:
   - A) [Option]
   - B) [Option]
   - C) [Option]

2. [Another follow-up question]
   Suggested answers:
   - A) [Option]
   - B) [Option]

3. Is there anything else you'd like to add or change about what we've discussed?

Ready to proceed to outline? Type 'Let's go!' or let me know if you have changes."
</interview_completion>`;

// =============================================================================
// FOLLOW-UP QUESTIONS SYSTEM
// =============================================================================

export const FOLLOW_UP_PROMPT = `You are generating strategic follow-up questions before handing off to the next agent.

<purpose>
These questions ensure nothing critical is missed and give the author one more chance to refine their vision before writing begins.
</purpose>

<follow_up_categories>
1. CLARITY QUESTIONS
   - "Just to confirm: [specific detail]. Is that correct?"
   - "Earlier you mentioned [X]. Did you mean [interpretation A] or [interpretation B]?"

2. DEPTH QUESTIONS
   - "You mentioned [interesting point]. Can you elaborate on why this is important?"
   - "How does [topic] connect to your main message?"

3. MISSING PIECE QUESTIONS
   - "We haven't discussed [gap]. Is this relevant to your project?"
   - "Most [document type] include [common element]. Should we include this?"

4. PRIORITY QUESTIONS
   - "If you could only convey ONE thing to your reader, what would it be?"
   - "Which chapter/section do you think is most critical to get right?"

5. CONCERN QUESTIONS
   - "What part of this project are you most uncertain about?"
   - "Is there anything that might get in the way of completing this?"
</follow_up_categories>

<format>
Generate 3-5 follow-up questions. For each question:
- State the question clearly
- Provide 2-3 suggested answers (but allow free response)
- Explain why this question matters (in parentheses)

Example:
**Q1: How comfortable are you with being vulnerable in your writing?**
Suggested:
- A) Very comfortable - I'm an open book
- B) Somewhat - depends on the topic
- C) Prefer to keep it professional

(This matters because: Vulnerability often makes non-fiction more compelling, but we need to respect your boundaries.)
</format>`;

// =============================================================================
// AGENT STATE MANAGEMENT
// =============================================================================

export interface InterviewState {
  phase: 'validation' | 'interview' | 'followup' | 'complete';
  validationScore?: number;
  validationVerdict?: 'STRONG' | 'PROMISING' | 'RISKY' | 'RECONSIDER';
  currentQuestionIndex: number;
  answeredQuestions: Map<string, string>;
  uploadedFiles: string[];
  summary?: string;
}

export function getNextQuestion(
  contentType: ContentType,
  state: InterviewState
): InterviewQuestion | null {
  const questions = INTERVIEW_QUESTIONS[contentType] || DEFAULT_QUESTIONS;
  
  if (state.currentQuestionIndex >= questions.length) {
    return null;
  }
  
  return questions[state.currentQuestionIndex];
}

export function calculateProgress(
  contentType: ContentType,
  state: InterviewState
): number {
  const questions = INTERVIEW_QUESTIONS[contentType] || DEFAULT_QUESTIONS;
  return Math.round((state.answeredQuestions.size / questions.length) * 100);
}

/**
 * Get interview questions for a content type as simple strings
 */
export function getInterviewQuestions(contentType: string): string[] {
  const questions = INTERVIEW_QUESTIONS[contentType as ContentType] || DEFAULT_QUESTIONS;
  return questions.map(q => q.question);
}

/**
 * Get the full rich interview questions for a content type, mapped into the
 * shape the UI's InterviewScreen expects. Preserves real options, helpText,
 * and the "Something else..." escape hatch on every multiple-choice question.
 */
export function getRichInterviewQuestions(contentType: string): Array<{
  id: string;
  question: string;
  type: 'open' | 'multiple_choice';
  options?: string[];
  helpText?: string;
  followUp?: string;
}> {
  const questions = INTERVIEW_QUESTIONS[contentType as ContentType] || DEFAULT_QUESTIONS;
  return questions.map((q) => {
    // Collapse 'scale' and 'yes_no' into 'open' for the UI (it only handles
    // 'open' vs 'multiple_choice' today). They read as open-ended text prompts.
    const uiType: 'open' | 'multiple_choice' =
      q.type === 'multiple_choice' ? 'multiple_choice' : 'open';

    return {
      id: q.id,
      question: q.question,
      type: uiType,
      options: uiType === 'multiple_choice' ? q.options : undefined,
      helpText: q.helpText,
      followUp: q.followUp,
    };
  });
}
