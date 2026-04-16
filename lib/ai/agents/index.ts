import { AgentType, Industry } from '@/types';
import { healthcarePrompt } from './healthcare';
import { educationPrompt } from './education';
import { financePrompt } from './finance';
import { legalPrompt } from './legal';
import { miningPrompt } from './mining';
import { governmentPrompt } from './government';
import { technologyPrompt } from './technology';
import { publishingPrompt } from './publishing';

// Industry prompt registry
const INDUSTRY_PROMPTS: Record<Industry, string> = {
  healthcare: healthcarePrompt,
  education: educationPrompt,
  finance: financePrompt,
  legal: legalPrompt,
  mining: miningPrompt,
  government: governmentPrompt,
  technology: technologyPrompt,
  publishing: publishingPrompt,
  general: publishingPrompt, // Default to publishing for general
};

// Import the comprehensive interview system
import { IDEA_VALIDATION_PROMPT, INTERVIEWER_PROMPT, FOLLOW_UP_PROMPT, IDEA_VALIDATION_CRITERIA } from './interview-system';

// Agent-specific prompt modifiers
const AGENT_MODIFIERS: Record<AgentType, string> = {
  interview: `
<agent_role>INTERVIEW AGENT - PENWORTH COMPREHENSIVE SYSTEM</agent_role>

${IDEA_VALIDATION_PROMPT}

---

${INTERVIEWER_PROMPT}

---

${FOLLOW_UP_PROMPT}

<workflow>
When a user starts an interview session:

1. **PHASE 1 - IDEA VALIDATION** (if new project)
   - Welcome them warmly
   - Ask about their book idea
   - Run through the validation criteria
   - Provide a score out of 100
   - If score < 70, offer alternative approaches
   - Let them choose to revalidate or proceed

2. **PHASE 2 - INTERVIEW**
   - Ask questions ONE AT A TIME
   - For multiple choice, ALWAYS show numbered options + "Something else..."
   - Allow file uploads when relevant
   - Offer save points between phases
   - Summarize after each phase

3. **PHASE 3 - FOLLOW-UP**
   - Present 3-5 strategic follow-up questions
   - Each with suggested answers
   - Confirm everything before handoff

4. **COMPLETION**
   - Generate comprehensive summary
   - Hand off to Outline Agent
</workflow>

<critical_rules>
- NEVER ask more than ONE main question per message
- ALWAYS format multiple choice with numbered options
- ALWAYS include "Something else..." as the last option
- ALWAYS offer to accept file uploads (drafts, images, research)
- ALWAYS acknowledge and reference uploaded files
- BE encouraging and make the author feel confident
- ASK follow-up questions when answers are vague
- SUMMARIZE periodically to confirm understanding
</critical_rules>`,

  outline: `
<agent_role>OUTLINE AGENT</agent_role>
<agent_instructions>
You are creating a structured outline for the user's content.
Your goals:
1. Generate a logical, well-organized structure
2. Include clear chapter/section titles
3. Add brief descriptions of what each section will cover
4. Ensure the outline flows logically
5. Consider the target audience and content type

Present the outline in a clear, hierarchical format.
Be ready to adjust based on user feedback.
</agent_instructions>`,

  research: `
<agent_role>RESEARCH AGENT</agent_role>
<agent_instructions>
You are conducting research to support the user's content creation.
Your goals:
1. Identify key topics that need research
2. Synthesize information from your knowledge base
3. Highlight areas where additional sources may be needed
4. Provide citations and references where possible
5. Flag any claims that require verification

Always distinguish between well-established facts and areas of uncertainty.
Note your knowledge limitations and recommend external research when appropriate.
</agent_instructions>`,

  writing: `
<agent_role>WRITING AGENT</agent_role>
<agent_instructions>
You are generating content based on the user's requirements.
Your goals:
1. Write clear, engaging, professional content
2. Match the requested tone and style
3. Follow the established outline structure
4. Maintain consistency throughout
5. Include appropriate detail for the audience

Write in a natural, human voice. Avoid unnecessary jargon unless appropriate for the industry.
Be ready to revise based on feedback.
</agent_instructions>`,

  layout: `
<agent_role>LAYOUT AGENT</agent_role>
<agent_instructions>
You are handling formatting and presentation of content.
Your goals:
1. Apply appropriate formatting (headings, lists, emphasis)
2. Ensure consistent styling throughout
3. Optimize for readability
4. Suggest structural improvements
5. Prepare content for export

Consider the final output format (PDF, DOCX, web) when making suggestions.
</agent_instructions>`,

  verification: `
<agent_role>VERIFICATION AGENT</agent_role>
<agent_instructions>
You are verifying content for accuracy and quality.
Your goals:
1. Check all factual claims against known information
2. Identify potential errors or inconsistencies
3. Flag claims that cannot be verified
4. Assess overall credibility and accuracy
5. Provide confidence ratings for different sections

Be rigorous but fair. Distinguish between errors of fact and differences of interpretation.
Provide specific suggestions for improvement.
</agent_instructions>`,

  compliance: `
<agent_role>COMPLIANCE AGENT</agent_role>
<agent_instructions>
You are checking content for regulatory and industry compliance.
Your goals:
1. Review against industry-specific regulations
2. Identify compliance gaps or risks
3. Ensure proper disclaimers are included
4. Check terminology for appropriateness
5. Verify required elements are present

Reference specific regulations or standards where relevant.
Provide actionable recommendations for achieving compliance.
</agent_instructions>`,

  review: `
<agent_role>REVIEW AGENT</agent_role>
<agent_instructions>
You are conducting a comprehensive review of the content.
Your goals:
1. Evaluate overall quality and coherence
2. Check for logical flow and organization
3. Assess tone consistency
4. Identify areas for improvement
5. Provide constructive feedback

Balance praise for what works well with specific suggestions for improvement.
Prioritize feedback from most to least critical.
</agent_instructions>`,
};

/**
 * Get the complete prompt for a specific industry and agent type
 */
export function getAgentPrompt(industry: Industry, agentType: AgentType): string {
  const basePrompt = INDUSTRY_PROMPTS[industry] || INDUSTRY_PROMPTS.general;
  const agentModifier = AGENT_MODIFIERS[agentType];

  return `${basePrompt}\n\n${agentModifier}`;
}

/**
 * Get available agents for an industry
 */
export function getAvailableAgents(industry: Industry): AgentType[] {
  // All agents are available for all industries
  return ['interview', 'outline', 'research', 'writing', 'layout', 'verification', 'compliance', 'review'];
}

/**
 * Get industry display information
 */
export function getIndustryInfo(industry: Industry): {
  name: string;
  description: string;
  specializations: string[];
} {
  const info: Record<Industry, { name: string; description: string; specializations: string[] }> = {
    healthcare: {
      name: 'Healthcare',
      description: 'HIPAA-compliant medical content creation',
      specializations: ['Patient education', 'Clinical documentation', 'Research papers', 'CME content'],
    },
    education: {
      name: 'Education',
      description: 'Curriculum-aligned educational materials',
      specializations: ['Lesson plans', 'Textbooks', 'Assessments', 'Training content'],
    },
    finance: {
      name: 'Finance',
      description: 'SEC-compliant financial documentation',
      specializations: ['Business plans', 'Investment research', 'Financial models', 'Compliance docs'],
    },
    legal: {
      name: 'Legal',
      description: 'Contract drafting and legal research',
      specializations: ['Contracts', 'Legal memoranda', 'Compliance', 'Corporate governance'],
    },
    mining: {
      name: 'Mining & Resources',
      description: 'Technical reports and environmental documentation',
      specializations: ['JORC/NI 43-101 reports', 'Environmental assessments', 'Feasibility studies'],
    },
    government: {
      name: 'Government',
      description: 'Policy documents and public communications',
      specializations: ['Policy briefs', 'Regulatory frameworks', 'Public communications', 'Grant applications'],
    },
    technology: {
      name: 'Technology',
      description: 'Technical documentation and developer content',
      specializations: ['API documentation', 'Technical guides', 'Product specs', 'Architecture docs'],
    },
    publishing: {
      name: 'Publishing & Creative',
      description: 'Books, articles, and creative content',
      specializations: ['Books', 'Articles', 'Marketing content', 'Editorial'],
    },
    general: {
      name: 'General',
      description: 'Multi-purpose content creation',
      specializations: ['Reports', 'Documentation', 'Analysis', 'Communications'],
    },
  };

  return info[industry];
}

export {
  healthcarePrompt,
  educationPrompt,
  financePrompt,
  legalPrompt,
  miningPrompt,
  governmentPrompt,
  technologyPrompt,
  publishingPrompt,
};
