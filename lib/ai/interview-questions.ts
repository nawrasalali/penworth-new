/**
 * Penworth Interview Questions — per document type.
 *
 * Each content type (or its flavor fallback) declares an ordered bank of
 * questions the interview agent asks the author. The agent is NOT free-form
 * here: the shape, count, and even the pre-made answer choices are
 * deterministic. That gives the author a fast experience (tap-tap-tap instead
 * of typing paragraphs) and gives every downstream agent (outline, research,
 * writing) a stable, parseable brief.
 *
 * Design principles
 *   - Most questions are single- or multi-select with 3-6 pre-made choices
 *   - Every question with choices ALWAYS allows 'Other' → free text
 *   - One or two text-only questions per doc type at most (the key creative
 *     input — topic angle, main thesis, audience pain)
 *   - Questions are plain-language and specific to the document type. A
 *     business plan author never sees book-style questions about narrator
 *     voice; a poet never sees questions about BISAC categories.
 *   - The validate-idea scoring rubric lives in the same file so the whole
 *     doc-type behaviour is in one place.
 */

import type { ContentType } from '@/types';
import type { DocumentFlavor } from './document-templates';
import { getTemplate } from './document-templates';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type InterviewQuestionType = 'single' | 'multi' | 'text';

export interface InterviewChoice {
  /** Stable ID sent back to the server. Keep short, snake_case. */
  id: string;
  /** Label shown to the user. */
  label: string;
  /** Optional sub-copy shown beneath the label. */
  hint?: string;
}

export interface InterviewQuestionSpec {
  /** Stable ID for this question (used in answers payload). */
  id: string;
  /** Short label shown at the top of the question card. */
  title: string;
  /** Longer prompt shown beneath the title explaining why we're asking. */
  prompt: string;
  /** Question type. */
  type: InterviewQuestionType;
  /** Pre-made answer choices (for single / multi). Omit for text. */
  choices?: InterviewChoice[];
  /**
   * If true, render an 'Other — please specify' option that reveals an
   * inline text input. Defaults to true for single/multi questions.
   */
  allowOther?: boolean;
  /** Placeholder shown in the free-text input (for text questions or Other). */
  placeholder?: string;
  /** Whether the question must be answered before Continue. */
  required?: boolean;
}

// -----------------------------------------------------------------------------
// Universal questions — shared by every document type
// -----------------------------------------------------------------------------

/**
 * The opener. Applied to every flavor so every downstream agent has an
 * audience signal. Audience wording is tailored per flavor below; this is
 * the generic fallback.
 */
const UNIVERSAL_AUDIENCE: InterviewQuestionSpec = {
  id: 'audience',
  title: 'Who is this for?',
  prompt: 'Describe the primary reader. Pick the closest match; the "Other" box is there for anything that isn\'t listed.',
  type: 'single',
  choices: [
    { id: 'general',      label: 'General public' },
    { id: 'professionals', label: 'Working professionals' },
    { id: 'experts',      label: 'Specialists or experts in the field' },
    { id: 'students',     label: 'Students' },
    { id: 'beginners',    label: 'Beginners / newcomers' },
  ],
  allowOther: true,
  placeholder: 'e.g. solo founders in Southeast Asia',
  required: true,
};

// -----------------------------------------------------------------------------
// NARRATIVE — fiction, non-fiction book, memoir, biography, self-help,
// children's book, travel, essay collection
// -----------------------------------------------------------------------------

const NARRATIVE_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'audience',
    title: 'Who is the reader?',
    prompt: 'Who do you picture reading this cover to cover?',
    type: 'single',
    choices: [
      { id: 'general_adult', label: 'General adult reader' },
      { id: 'young_adult',   label: 'Young adult (13–18)' },
      { id: 'middle_grade',  label: 'Middle grade (8–12)' },
      { id: 'children',      label: 'Children (under 8)' },
      { id: 'professionals', label: 'Working professionals' },
      { id: 'enthusiasts',   label: 'Hobbyists / enthusiasts in a niche' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'tone',
    title: 'What tone do you want?',
    prompt: 'Pick one or more. The writing agent blends the ones you choose.',
    type: 'multi',
    choices: [
      { id: 'conversational', label: 'Conversational & warm' },
      { id: 'authoritative',  label: 'Authoritative & expert' },
      { id: 'inspirational',  label: 'Inspirational & uplifting' },
      { id: 'story_driven',   label: 'Story-driven & narrative' },
      { id: 'challenging',    label: 'Challenging & provocative' },
      { id: 'humorous',       label: 'Humorous & playful' },
      { id: 'academic',       label: 'Rigorous & academic' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'chapter_count',
    title: 'Roughly how many chapters?',
    prompt: 'Don\'t worry about being exact — the outline agent will lock this in.',
    type: 'single',
    choices: [
      { id: '5_8',   label: '5 – 8 chapters'   , hint: 'Concise, single-sitting read' },
      { id: '10_15', label: '10 – 15 chapters' , hint: 'Standard trade book' },
      { id: '15_20', label: '15 – 20 chapters' , hint: 'Deep dive' },
      { id: '20_plus', label: '20+ chapters'   , hint: 'Epic / saga length' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'transformation',
    title: 'What should the reader walk away with?',
    prompt: 'The single most important thing they learn, feel, or can do after finishing. One or two sentences.',
    type: 'text',
    placeholder: 'After reading, they will understand…',
    required: true,
  },
  {
    id: 'differentiator',
    title: 'What makes this different from existing books on the topic?',
    prompt: 'Your angle, lived experience, evidence, or fresh framing — whatever separates it.',
    type: 'text',
    placeholder: 'Most books on this say X. I\'m saying Y because…',
    required: true,
  },
  {
    id: 'market',
    title: 'Where should the book land commercially?',
    prompt: 'The platform optimises pricing and distribution based on your choice.',
    type: 'single',
    choices: [
      { id: 'global',     label: 'Global English' },
      { id: 'us_canada',  label: 'USA & Canada' },
      { id: 'uk_europe',  label: 'UK & Europe' },
      { id: 'asia_pac',   label: 'Asia-Pacific' },
      { id: 'middle_east', label: 'Middle East & North Africa' },
    ],
    allowOther: true,
    required: true,
  },
];

// -----------------------------------------------------------------------------
// BUSINESS — business plan, proposal, white paper, report, pitch deck
// -----------------------------------------------------------------------------

const BUSINESS_PLAN_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'stage',
    title: 'What stage is the business at?',
    prompt: 'The plan is written very differently for a napkin idea vs a funded company.',
    type: 'single',
    choices: [
      { id: 'idea',        label: 'Pre-launch idea' },
      { id: 'mvp',         label: 'MVP built, no customers yet' },
      { id: 'early',       label: 'Early customers / revenue' },
      { id: 'growth',      label: 'Growth stage / scaling' },
      { id: 'mature',      label: 'Mature business / expansion' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'purpose',
    title: 'Who is this plan for?',
    prompt: 'The audience changes the structure and what we emphasise.',
    type: 'single',
    choices: [
      { id: 'investors',   label: 'External investors / VCs' },
      { id: 'bank',        label: 'Bank / loan officer' },
      { id: 'internal',    label: 'Internal team / leadership' },
      { id: 'grant',       label: 'Grant application' },
      { id: 'personal',    label: 'Personal roadmap / strategy' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'industry',
    title: 'What industry does the business operate in?',
    prompt: 'Exact industry drives market-analysis language and competitor framing.',
    type: 'text',
    placeholder: 'e.g. B2B SaaS for mid-market retailers',
    required: true,
  },
  {
    id: 'problem',
    title: 'What problem does the business solve?',
    prompt: 'One clear sentence on the pain it removes for customers.',
    type: 'text',
    placeholder: 'Small retailers lose 4+ hours a week reconciling inventory because…',
    required: true,
  },
  {
    id: 'revenue_model',
    title: 'How does (or will) the business make money?',
    prompt: 'Pick the closest — you can refine in the plan itself.',
    type: 'single',
    choices: [
      { id: 'subscription', label: 'Subscription / SaaS' },
      { id: 'transactional', label: 'Transactional / per-purchase' },
      { id: 'marketplace',  label: 'Marketplace take rate' },
      { id: 'advertising',  label: 'Advertising' },
      { id: 'services',     label: 'Professional services' },
      { id: 'licensing',    label: 'Licensing / royalties' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'funding_ask',
    title: 'Is there a funding ask?',
    prompt: 'If yes, we include a Use of Funds section.',
    type: 'single',
    choices: [
      { id: 'none',        label: 'No funding ask — strategy doc' },
      { id: 'under_100k',  label: 'Under $100K' },
      { id: '100k_500k',   label: '$100K – $500K' },
      { id: '500k_2m',     label: '$500K – $2M' },
      { id: '2m_plus',     label: '$2M+' },
    ],
    allowOther: true,
    required: true,
  },
];

const PROPOSAL_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'proposal_type',
    title: 'What kind of proposal is this?',
    prompt: 'The shape of the document depends on the type.',
    type: 'single',
    choices: [
      { id: 'project',       label: 'Project proposal (scope + deliverables)' },
      { id: 'partnership',   label: 'Partnership / JV proposal' },
      { id: 'sales',         label: 'Sales proposal (pitch a product/service)' },
      { id: 'grant',         label: 'Grant proposal' },
      { id: 'rfp_response',  label: 'RFP / tender response' },
      { id: 'research',      label: 'Research proposal' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'recipient',
    title: 'Who will receive this proposal?',
    prompt: 'Name the organisation or role so we speak to them directly.',
    type: 'text',
    placeholder: 'e.g. Head of Procurement, Acme Corp',
    required: true,
  },
  {
    id: 'objective',
    title: 'What are you asking them to say yes to?',
    prompt: 'The single outcome you want when they finish reading.',
    type: 'text',
    placeholder: 'Approve $120K over 6 months for…',
    required: true,
  },
  {
    id: 'budget_range',
    title: 'Is a budget involved?',
    prompt: 'Even a rough band helps — we\'ll frame ROI around it.',
    type: 'single',
    choices: [
      { id: 'none',         label: 'No money changes hands' },
      { id: 'under_10k',    label: 'Under $10K' },
      { id: '10k_50k',      label: '$10K – $50K' },
      { id: '50k_250k',     label: '$50K – $250K' },
      { id: '250k_plus',    label: '$250K+' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'tone',
    title: 'How formal?',
    prompt: 'We match your tone exactly.',
    type: 'single',
    choices: [
      { id: 'formal',       label: 'Formal / corporate' },
      { id: 'professional', label: 'Professional but warm' },
      { id: 'conversational', label: 'Conversational' },
    ],
    allowOther: true,
    required: true,
  },
];

const WHITE_PAPER_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'audience',
    title: 'Who reads this white paper?',
    prompt: 'White papers are technical-reader documents by default.',
    type: 'single',
    choices: [
      { id: 'executives',   label: 'C-suite executives' },
      { id: 'technical',    label: 'Technical decision-makers' },
      { id: 'analysts',     label: 'Industry analysts' },
      { id: 'policymakers', label: 'Policymakers / regulators' },
      { id: 'academics',    label: 'Academics' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'goal',
    title: 'What\'s the white paper\'s goal?',
    prompt: 'The goal drives whether we lean on data, argument, or narrative.',
    type: 'single',
    choices: [
      { id: 'thought_leadership', label: 'Establish thought leadership' },
      { id: 'explain_tech',       label: 'Explain a new technology or method' },
      { id: 'persuade_policy',    label: 'Persuade a policy position' },
      { id: 'research_findings',  label: 'Publish research findings' },
      { id: 'problem_solution',   label: 'Define a problem and solution' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'thesis',
    title: 'What is the core claim?',
    prompt: 'One sentence on the central argument we\'re defending.',
    type: 'text',
    placeholder: 'Decentralised storage reduces CDN costs by 40% when…',
    required: true,
  },
  {
    id: 'evidence',
    title: 'What kind of evidence do we lean on?',
    prompt: 'Pick one or more — the research agent prioritises these sources.',
    type: 'multi',
    choices: [
      { id: 'peer_reviewed', label: 'Peer-reviewed research' },
      { id: 'industry_data', label: 'Industry reports / market data' },
      { id: 'case_studies',  label: 'Case studies' },
      { id: 'first_party',   label: 'Our own / first-party data' },
      { id: 'expert_quotes', label: 'Expert interviews and quotes' },
    ],
    allowOther: true,
    required: true,
  },
];

const REPORT_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'report_type',
    title: 'What kind of report is this?',
    prompt: 'Structure varies significantly by type.',
    type: 'single',
    choices: [
      { id: 'analytical',   label: 'Analytical report' },
      { id: 'progress',     label: 'Progress / status report' },
      { id: 'research',     label: 'Research report' },
      { id: 'annual',       label: 'Annual report' },
      { id: 'incident',     label: 'Incident / post-mortem' },
      { id: 'due_diligence', label: 'Due diligence report' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'reporting_period',
    title: 'What time period does it cover?',
    prompt: 'So the writing agent uses the right tense and framing.',
    type: 'single',
    choices: [
      { id: 'week',    label: 'A single week' },
      { id: 'month',   label: 'One month' },
      { id: 'quarter', label: 'One quarter' },
      { id: 'year',    label: 'A full year' },
      { id: 'project', label: 'Entire project lifecycle' },
      { id: 'n_a',     label: 'Not time-bound' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'key_findings',
    title: 'What are the headline findings?',
    prompt: '2-4 bullet points. These become the executive summary.',
    type: 'text',
    placeholder: '- Revenue grew 23% QoQ\n- Churn dropped from 8% to 3%\n- Three regions underperformed',
    required: true,
  },
  {
    id: 'audience',
    title: 'Who reads this report?',
    prompt: 'Tone and jargon level follow from this.',
    type: 'single',
    choices: [
      { id: 'board',        label: 'Board of directors' },
      { id: 'executives',   label: 'Executive team' },
      { id: 'investors',    label: 'Investors' },
      { id: 'internal',     label: 'Internal staff' },
      { id: 'regulators',   label: 'Regulators / external audit' },
      { id: 'public',       label: 'Public / press' },
    ],
    allowOther: true,
    required: true,
  },
];

// -----------------------------------------------------------------------------
// ACADEMIC — paper, thesis, dissertation, educational
// -----------------------------------------------------------------------------

const ACADEMIC_PAPER_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'field',
    title: 'What discipline is this in?',
    prompt: 'Pick the closest — the research agent filters sources accordingly.',
    type: 'single',
    choices: [
      { id: 'stem',         label: 'STEM (natural sciences, engineering)' },
      { id: 'medicine',     label: 'Medicine / health sciences' },
      { id: 'social',       label: 'Social sciences' },
      { id: 'humanities',   label: 'Humanities' },
      { id: 'business',     label: 'Business / economics' },
      { id: 'law',          label: 'Law' },
      { id: 'education',    label: 'Education' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'paper_type',
    title: 'What kind of paper is it?',
    prompt: 'The structure differs by type.',
    type: 'single',
    choices: [
      { id: 'empirical',    label: 'Empirical study (original data)' },
      { id: 'literature',   label: 'Literature review' },
      { id: 'theoretical',  label: 'Theoretical / conceptual paper' },
      { id: 'case_study',   label: 'Case study' },
      { id: 'meta',         label: 'Meta-analysis / systematic review' },
      { id: 'methods',      label: 'Methods paper' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'research_question',
    title: 'What is the research question?',
    prompt: 'One sentence, phrased as a question your paper answers.',
    type: 'text',
    placeholder: 'Does remote work change employee retention in early-career engineers?',
    required: true,
  },
  {
    id: 'methodology',
    title: 'What methodology did you use (or plan to use)?',
    prompt: 'If this is a proposal rather than completed work, describe your intended approach.',
    type: 'multi',
    choices: [
      { id: 'quantitative', label: 'Quantitative (survey, experiment)' },
      { id: 'qualitative',  label: 'Qualitative (interviews, ethnography)' },
      { id: 'mixed',        label: 'Mixed methods' },
      { id: 'archival',     label: 'Archival / document analysis' },
      { id: 'computational', label: 'Computational / simulation' },
      { id: 'theoretical',  label: 'Purely theoretical (no data)' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'target_venue',
    title: 'Where do you hope to publish it?',
    prompt: 'Style conventions differ — Nature reads very differently from a dissertation.',
    type: 'single',
    choices: [
      { id: 'top_journal',   label: 'Top-tier journal' },
      { id: 'mid_journal',   label: 'Mid-tier / field-specific journal' },
      { id: 'conference',    label: 'Conference proceedings' },
      { id: 'preprint',      label: 'Preprint server (arXiv, SSRN)' },
      { id: 'thesis',        label: 'Thesis / dissertation submission' },
      { id: 'undecided',     label: 'Undecided' },
    ],
    allowOther: true,
    required: true,
  },
];

const THESIS_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'degree_level',
    title: 'What level of thesis?',
    prompt: 'Expectations differ substantially between undergraduate and PhD.',
    type: 'single',
    choices: [
      { id: 'undergrad',    label: 'Undergraduate thesis' },
      { id: 'masters',      label: 'Master\'s thesis' },
      { id: 'phd',          label: 'PhD dissertation' },
      { id: 'professional', label: 'Professional doctorate (EdD, DBA, DNP)' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'field',
    title: 'Which field?',
    prompt: 'Pick the closest match.',
    type: 'single',
    choices: [
      { id: 'stem',         label: 'STEM / sciences' },
      { id: 'medicine',     label: 'Medicine / health sciences' },
      { id: 'social',       label: 'Social sciences' },
      { id: 'humanities',   label: 'Humanities' },
      { id: 'business',     label: 'Business / economics' },
      { id: 'law',          label: 'Law' },
      { id: 'education',    label: 'Education' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'research_question',
    title: 'What is the central research question?',
    prompt: 'State it as a question. This becomes the spine of the entire thesis.',
    type: 'text',
    placeholder: 'How does X affect Y under conditions Z?',
    required: true,
  },
  {
    id: 'contribution',
    title: 'What is the original contribution?',
    prompt: 'The new knowledge this thesis adds. One or two sentences.',
    type: 'text',
    placeholder: 'This thesis is the first to empirically show that…',
    required: true,
  },
  {
    id: 'methodology',
    title: 'Methodology',
    prompt: 'Pick all that apply.',
    type: 'multi',
    choices: [
      { id: 'quantitative', label: 'Quantitative' },
      { id: 'qualitative',  label: 'Qualitative' },
      { id: 'mixed',        label: 'Mixed methods' },
      { id: 'archival',     label: 'Archival / historical' },
      { id: 'computational', label: 'Computational' },
      { id: 'theoretical',  label: 'Theoretical / mathematical' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'chapter_target',
    title: 'How many chapters does your department expect?',
    prompt: 'Most theses have 5–8 chapters. Check with your supervisor if unsure.',
    type: 'single',
    choices: [
      { id: '5',   label: '5 chapters (classic IMRaD + discussion)' },
      { id: '6',   label: '6 chapters' },
      { id: '7',   label: '7 chapters' },
      { id: '8',   label: '8 chapters' },
      { id: '9_plus', label: '9 or more' },
    ],
    allowOther: true,
    required: true,
  },
];

// -----------------------------------------------------------------------------
// LEGAL — contract, NDA, ToS, privacy policy, policy doc
// -----------------------------------------------------------------------------

const LEGAL_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'doc_type',
    title: 'What kind of legal document is this?',
    prompt: 'The clauses and language differ significantly.',
    type: 'single',
    choices: [
      { id: 'services_contract', label: 'Services contract' },
      { id: 'employment',        label: 'Employment contract' },
      { id: 'nda',               label: 'NDA / confidentiality' },
      { id: 'sale',              label: 'Sale / purchase agreement' },
      { id: 'partnership',       label: 'Partnership / shareholders agreement' },
      { id: 'tos',               label: 'Website Terms of Service' },
      { id: 'privacy',           label: 'Privacy Policy' },
      { id: 'internal_policy',   label: 'Internal company policy' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'parties',
    title: 'Who are the parties?',
    prompt: 'Name both sides of the agreement (or "N/A" for internal policies / public ToS).',
    type: 'text',
    placeholder: 'Party A: Acme Pty Ltd. Party B: Jane Smith (contractor)',
    required: true,
  },
  {
    id: 'jurisdiction',
    title: 'Governing law / jurisdiction?',
    prompt: 'Crucial — clauses and enforceability vary by jurisdiction.',
    type: 'single',
    choices: [
      { id: 'au',       label: 'Australia' },
      { id: 'us',       label: 'United States (specify state in Other)' },
      { id: 'uk',       label: 'United Kingdom' },
      { id: 'eu',       label: 'European Union' },
      { id: 'canada',   label: 'Canada' },
      { id: 'singapore', label: 'Singapore' },
      { id: 'uae',      label: 'UAE' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'core_terms',
    title: 'What are the core commercial terms?',
    prompt: 'Value, duration, obligations. Anything specific we must include.',
    type: 'text',
    placeholder: 'Term: 12 months. Fee: $8,000/month. Payment: monthly in advance…',
    required: true,
  },
  {
    id: 'risk_level',
    title: 'How risk-averse should the clauses be?',
    prompt: 'Tilts liability caps, termination rights, indemnities.',
    type: 'single',
    choices: [
      { id: 'balanced',    label: 'Balanced / standard' },
      { id: 'buyer_side',  label: 'Strongly favours the client / buyer side' },
      { id: 'seller_side', label: 'Strongly favours the vendor / seller side' },
      { id: 'conservative', label: 'Maximum protection / conservative' },
    ],
    allowOther: true,
    required: true,
  },
];

// -----------------------------------------------------------------------------
// TECHNICAL — technical doc, API docs, user manual, specification
// -----------------------------------------------------------------------------

const TECHNICAL_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'doc_type',
    title: 'What kind of technical document?',
    prompt: 'Structure and depth vary a lot.',
    type: 'single',
    choices: [
      { id: 'getting_started', label: 'Getting started guide' },
      { id: 'api_reference',   label: 'API reference' },
      { id: 'user_manual',     label: 'User manual' },
      { id: 'architecture',    label: 'Architecture / design doc' },
      { id: 'specification',   label: 'Formal specification / RFC' },
      { id: 'runbook',         label: 'Runbook / operations guide' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'product_or_system',
    title: 'What is the product or system?',
    prompt: 'Name it and describe what it does in one line.',
    type: 'text',
    placeholder: 'Lunar — a Postgres-compatible analytical database',
    required: true,
  },
  {
    id: 'audience',
    title: 'Who is reading this?',
    prompt: 'Skill level drives how much we explain vs assume.',
    type: 'single',
    choices: [
      { id: 'end_users',    label: 'End users (non-technical)' },
      { id: 'integrators',  label: 'Developers integrating with it' },
      { id: 'ops',          label: 'Operations / DevOps engineers' },
      { id: 'internal_eng', label: 'Internal engineering team' },
      { id: 'partners',     label: 'Technical partners / resellers' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'code_examples',
    title: 'Which code languages should the examples use?',
    prompt: 'Pick one or more. The writing agent picks the first one by default.',
    type: 'multi',
    choices: [
      { id: 'typescript', label: 'TypeScript / JavaScript' },
      { id: 'python',     label: 'Python' },
      { id: 'go',         label: 'Go' },
      { id: 'rust',       label: 'Rust' },
      { id: 'java',       label: 'Java' },
      { id: 'bash',       label: 'Shell / Bash' },
      { id: 'none',       label: 'No code examples needed' },
    ],
    allowOther: true,
    required: true,
  },
];

// -----------------------------------------------------------------------------
// REFERENCE — cookbook, travel guide
// -----------------------------------------------------------------------------

const COOKBOOK_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'cuisine',
    title: 'Which cuisine(s)?',
    prompt: 'Pick one or more. We\'ll organise chapters around these.',
    type: 'multi',
    choices: [
      { id: 'italian',      label: 'Italian' },
      { id: 'french',       label: 'French' },
      { id: 'chinese',      label: 'Chinese' },
      { id: 'japanese',     label: 'Japanese' },
      { id: 'indian',       label: 'Indian' },
      { id: 'middle_east',  label: 'Middle Eastern' },
      { id: 'mediterranean', label: 'Mediterranean' },
      { id: 'american',     label: 'American / BBQ' },
      { id: 'latin',        label: 'Latin / South American' },
      { id: 'fusion',       label: 'Fusion / cross-cultural' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'skill_level',
    title: 'Who is cooking?',
    prompt: 'We tune recipe complexity and ingredient assumptions.',
    type: 'single',
    choices: [
      { id: 'beginners',  label: 'Complete beginners' },
      { id: 'home_cooks', label: 'Confident home cooks' },
      { id: 'enthusiasts', label: 'Ambitious enthusiasts' },
      { id: 'pros',       label: 'Professional chefs' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'recipe_count',
    title: 'Roughly how many recipes?',
    prompt: 'Outline agent will set the final count.',
    type: 'single',
    choices: [
      { id: '20',   label: 'Around 20 (small themed book)' },
      { id: '40',   label: 'Around 40 (standard cookbook)' },
      { id: '75',   label: 'Around 75 (comprehensive)' },
      { id: '100_plus', label: '100+ (reference volume)' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'dietary',
    title: 'Any dietary angle?',
    prompt: 'Pick all that apply or none.',
    type: 'multi',
    choices: [
      { id: 'none',         label: 'No restrictions' },
      { id: 'vegetarian',   label: 'Vegetarian' },
      { id: 'vegan',        label: 'Vegan' },
      { id: 'gluten_free',  label: 'Gluten-free' },
      { id: 'keto',         label: 'Keto / low-carb' },
      { id: 'halal',        label: 'Halal' },
      { id: 'kosher',       label: 'Kosher' },
    ],
    allowOther: true,
    required: false,
  },
];

// -----------------------------------------------------------------------------
// SHORT-FORM — poetry, short story, essay, screenplay
// -----------------------------------------------------------------------------

const POETRY_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'form',
    title: 'What form(s) do you want to work in?',
    prompt: 'Pick all that apply. The writing agent blends them across the collection.',
    type: 'multi',
    choices: [
      { id: 'free_verse', label: 'Free verse' },
      { id: 'sonnet',     label: 'Sonnet' },
      { id: 'haiku',      label: 'Haiku' },
      { id: 'villanelle', label: 'Villanelle' },
      { id: 'ghazal',     label: 'Ghazal' },
      { id: 'prose_poem', label: 'Prose poem' },
      { id: 'spoken_word', label: 'Spoken word' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'theme',
    title: 'What is the collection about?',
    prompt: 'The emotional or thematic through-line.',
    type: 'text',
    placeholder: 'Grief, migration, the sea at dusk…',
    required: true,
  },
  {
    id: 'voice',
    title: 'Whose voice?',
    prompt: 'The speaker of the poems.',
    type: 'single',
    choices: [
      { id: 'first_person',  label: 'First-person / personal' },
      { id: 'persona',       label: 'Persona / character' },
      { id: 'observational', label: 'Observational third-person' },
      { id: 'collective',    label: 'Collective / we' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'poem_count',
    title: 'Roughly how many poems?',
    prompt: 'Standard is 30–60 for a chapbook or collection.',
    type: 'single',
    choices: [
      { id: '20',    label: '~20 (short chapbook)' },
      { id: '30_40', label: '30 – 40' },
      { id: '50_70', label: '50 – 70 (full collection)' },
      { id: '80_plus', label: '80+' },
    ],
    allowOther: true,
    required: true,
  },
];

const SHORT_STORY_QUESTIONS: InterviewQuestionSpec[] = [
  {
    id: 'genre',
    title: 'What genre?',
    prompt: 'Pick the closest — hybrid is fine.',
    type: 'single',
    choices: [
      { id: 'literary',    label: 'Literary / slice of life' },
      { id: 'crime',       label: 'Crime / mystery' },
      { id: 'sci_fi',      label: 'Science fiction' },
      { id: 'fantasy',     label: 'Fantasy' },
      { id: 'horror',      label: 'Horror' },
      { id: 'romance',     label: 'Romance' },
      { id: 'historical',  label: 'Historical' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'length',
    title: 'How long should it be?',
    prompt: 'We hit the word count you choose within 5%.',
    type: 'single',
    choices: [
      { id: 'flash',   label: 'Flash fiction (~1,000 words)' },
      { id: 'short',   label: 'Short (~3,000 words)' },
      { id: 'medium',  label: 'Medium (~5,000 words)' },
      { id: 'novelette', label: 'Novelette (~10,000 words)' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'pov',
    title: 'Point of view?',
    prompt: '',
    type: 'single',
    choices: [
      { id: 'first',       label: 'First person' },
      { id: 'third_close', label: 'Third person close' },
      { id: 'third_omni',  label: 'Third person omniscient' },
      { id: 'second',      label: 'Second person' },
    ],
    allowOther: true,
    required: true,
  },
  {
    id: 'premise',
    title: 'What\'s the premise?',
    prompt: 'One sentence. What happens and why it matters.',
    type: 'text',
    placeholder: 'A midwife in a drought-stricken town realises…',
    required: true,
  },
];

// -----------------------------------------------------------------------------
// Mapping content type → question bank
// -----------------------------------------------------------------------------

const CONTENT_TYPE_QUESTIONS: Partial<Record<ContentType, InterviewQuestionSpec[]>> = {
  // Narrative
  'non-fiction':      NARRATIVE_QUESTIONS,
  'fiction':          NARRATIVE_QUESTIONS,
  'memoir':           NARRATIVE_QUESTIONS,
  'self-help':        NARRATIVE_QUESTIONS,
  'biography':        NARRATIVE_QUESTIONS,
  'children':         NARRATIVE_QUESTIONS,
  'travel':           NARRATIVE_QUESTIONS,
  'essay_collection': NARRATIVE_QUESTIONS,
  'book':             NARRATIVE_QUESTIONS,
  'business':         NARRATIVE_QUESTIONS,  // business BOOK (not plan)

  // Business documents (not books)
  'business_plan':    BUSINESS_PLAN_QUESTIONS,
  'proposal':         PROPOSAL_QUESTIONS,
  'pitch_deck':       PROPOSAL_QUESTIONS,
  'white_paper':      WHITE_PAPER_QUESTIONS,
  'financial_model':  WHITE_PAPER_QUESTIONS,
  'report':           REPORT_QUESTIONS,

  // Academic
  'paper':            ACADEMIC_PAPER_QUESTIONS,
  'research_paper':   ACADEMIC_PAPER_QUESTIONS,
  'academic':         ACADEMIC_PAPER_QUESTIONS,
  'thesis':           THESIS_QUESTIONS,
  'dissertation':     THESIS_QUESTIONS,
  'educational':      ACADEMIC_PAPER_QUESTIONS,

  // Legal
  'contract':         LEGAL_QUESTIONS,
  'nda':              LEGAL_QUESTIONS,
  'terms_of_service': LEGAL_QUESTIONS,
  'privacy_policy':   LEGAL_QUESTIONS,
  'policy_document':  LEGAL_QUESTIONS,
  'policy':           LEGAL_QUESTIONS,
  'legal_brief':      LEGAL_QUESTIONS,

  // Technical
  'technical':        TECHNICAL_QUESTIONS,
  'technical_doc':    TECHNICAL_QUESTIONS,
  'api_docs':         TECHNICAL_QUESTIONS,
  'user_manual':      TECHNICAL_QUESTIONS,
  'specification':    TECHNICAL_QUESTIONS,

  // Reference
  'cookbook':         COOKBOOK_QUESTIONS,

  // Short-form
  'poetry':           POETRY_QUESTIONS,
  'short_story':      SHORT_STORY_QUESTIONS,
  'screenplay':       SHORT_STORY_QUESTIONS,
};

const FLAVOR_FALLBACK: Record<DocumentFlavor, InterviewQuestionSpec[]> = {
  narrative:     NARRATIVE_QUESTIONS,
  instructional: NARRATIVE_QUESTIONS,
  academic:      ACADEMIC_PAPER_QUESTIONS,
  business:      BUSINESS_PLAN_QUESTIONS,
  legal:         LEGAL_QUESTIONS,
  technical:     TECHNICAL_QUESTIONS,
  reference:     COOKBOOK_QUESTIONS,
  short_form:    SHORT_STORY_QUESTIONS,
};

/**
 * Returns the interview question bank for a given content type. Falls back
 * to the doc flavor's questions, then to a generic universal set.
 */
export function getInterviewQuestions(contentType: string | null | undefined): InterviewQuestionSpec[] {
  if (contentType && CONTENT_TYPE_QUESTIONS[contentType as ContentType]) {
    return CONTENT_TYPE_QUESTIONS[contentType as ContentType]!;
  }
  const template = getTemplate(contentType);
  return FLAVOR_FALLBACK[template.flavor] || [UNIVERSAL_AUDIENCE];
}

// -----------------------------------------------------------------------------
// VALIDATE copy + rubric per content type
// -----------------------------------------------------------------------------

export interface ValidationRubric {
  /** Copy shown on the "Validate your idea" screen under the heading. */
  intro: string;
  /** Placeholder shown in the topic/idea textarea. */
  inputPlaceholder: string;
  /** Label shown above the textarea. */
  inputLabel: string;
  /** Primary button label for kicking off validation. */
  buttonLabel: string;
  /**
   * Six weighted criteria the validation prompt scores against. Keep to six
   * so the breakdown pie chart in the UI stays readable. Weights should sum
   * to ~1.0 (the JSON rubric is already calibrated).
   */
  criteria: Array<{
    key: string;
    label: string;
    weight: number;
    description: string;
  }>;
  /** System-prompt description of the expert persona doing the scoring. */
  expertise: string;
}

const NARRATIVE_RUBRIC: ValidationRubric = {
  intro:
    'Describe your book idea — the subject, who it\'s for, and what\'s new about your angle. We\'ll estimate market demand, audience fit, and where to position it to help you decide.',
  inputLabel: 'Your book idea',
  inputPlaceholder:
    'A practical guide for first-time founders in Southeast Asia on raising seed capital without a US-based network. My angle is…',
  buttonLabel: 'Validate my book idea',
  expertise: 'expert publishing consultant, acquisitions editor, and market analyst with 15+ years across trade and self-publishing',
  criteria: [
    { key: 'marketDemand',         label: 'Market demand',          weight: 0.20, description: 'Proven reader demand; search volume; active buyers' },
    { key: 'targetAudience',       label: 'Audience clarity',        weight: 0.15, description: 'A clearly defined, reachable reader segment' },
    { key: 'uniqueValue',          label: 'Unique angle',            weight: 0.20, description: 'Fresh, differentiated from existing books on the topic' },
    { key: 'authorCredibility',    label: 'Author fit',              weight: 0.15, description: 'The author\'s ability to write this with authority' },
    { key: 'commercialViability',  label: 'Commercial viability',    weight: 0.15, description: 'Pricing, discoverability, realistic revenue path' },
    { key: 'executionFeasibility', label: 'Execution feasibility',   weight: 0.15, description: 'Scope is achievable without legal/ethical risk' },
  ],
};

const BUSINESS_PLAN_RUBRIC: ValidationRubric = {
  intro:
    'Describe the business and what this plan is for. We\'ll evaluate market opportunity, defensibility, and whether the plan is investor-ready to help you strengthen it before you present.',
  inputLabel: 'Your business idea',
  inputPlaceholder:
    'A subscription inventory-management SaaS for independent retailers in Southeast Asia. We sell to 10-50 store owners for $89/month. Our moat is…',
  buttonLabel: 'Validate my business idea',
  expertise: 'seasoned venture investor, YC-trained founder mentor, and MBA strategy professor',
  criteria: [
    { key: 'marketSize',       label: 'Market size',              weight: 0.20, description: 'TAM, SAM, SOM clarity and credibility' },
    { key: 'problemUrgency',   label: 'Problem urgency',           weight: 0.20, description: 'How painful and expensive the problem is' },
    { key: 'differentiation',  label: 'Differentiation / moat',    weight: 0.15, description: 'Structural advantages competitors can\'t easily copy' },
    { key: 'unitEconomics',    label: 'Unit economics',            weight: 0.15, description: 'Plausible CAC, LTV, margin; path to profitability' },
    { key: 'teamFit',          label: 'Team fit',                  weight: 0.15, description: 'Why this team can execute this specifically' },
    { key: 'executionPath',    label: 'Execution path',            weight: 0.15, description: 'Realistic go-to-market and scaling plan' },
  ],
};

const PROPOSAL_RUBRIC: ValidationRubric = {
  intro:
    'Describe the proposal — what you\'re proposing, to whom, and what you want them to approve. We\'ll assess clarity, value alignment, and persuasiveness to help you win the yes.',
  inputLabel: 'Your proposal idea',
  inputPlaceholder:
    'A 6-month consulting engagement to overhaul Acme Corp\'s procurement system, pitched to their Head of Operations for $180K…',
  buttonLabel: 'Validate my proposal',
  expertise: 'senior sales engineer, management consultant, and RFP strategist',
  criteria: [
    { key: 'audienceFit',      label: 'Audience alignment',        weight: 0.20, description: 'How well the ask matches the recipient\'s actual priorities' },
    { key: 'valueClarity',     label: 'Value clarity',             weight: 0.20, description: 'Is the value to the recipient quantified and obvious?' },
    { key: 'differentiation',  label: 'Differentiation',           weight: 0.15, description: 'Why the proposer over any alternative' },
    { key: 'feasibility',      label: 'Feasibility',               weight: 0.15, description: 'Scope, timeline, resources match the ask' },
    { key: 'riskMitigation',   label: 'Risk mitigation',           weight: 0.15, description: 'Addresses the recipient\'s likely objections and risks' },
    { key: 'priceJustification', label: 'Price justification',     weight: 0.15, description: 'Pricing tied clearly to delivered outcomes' },
  ],
};

const ACADEMIC_RUBRIC: ValidationRubric = {
  intro:
    'Describe the research question and what\'s new about the approach. We\'ll assess novelty, methodological fit, and likely reception in your field to help you shape a defensible paper.',
  inputLabel: 'Your research topic',
  inputPlaceholder:
    'A mixed-methods study of how remote work affects early-career engineer retention in mid-sized tech firms, using N=300 survey + 40 interviews…',
  buttonLabel: 'Validate my research idea',
  expertise: 'tenured researcher, peer-review editor, and dissertation advisor',
  criteria: [
    { key: 'novelty',             label: 'Novelty / contribution',  weight: 0.25, description: 'Adds genuinely new knowledge to the field' },
    { key: 'methodological',      label: 'Methodological fit',      weight: 0.20, description: 'Methods match the research question; rigour is achievable' },
    { key: 'literatureGap',       label: 'Literature gap',          weight: 0.15, description: 'Clearly identified gap in existing scholarship' },
    { key: 'scope',               label: 'Scope',                   weight: 0.15, description: 'Feasible within the constraints (time, data, IRB)' },
    { key: 'publicationFit',      label: 'Publication venue fit',   weight: 0.15, description: 'Topic and style match target journals or committee norms' },
    { key: 'ethics',              label: 'Ethics & compliance',     weight: 0.10, description: 'No IRB red flags; data sources are legitimate' },
  ],
};

const LEGAL_RUBRIC: ValidationRubric = {
  intro:
    'Describe the legal document you need — the parties, the commercial deal, and the jurisdiction. We\'ll assess completeness, risk balance, and enforceability to help you spot gaps before drafting.',
  inputLabel: 'Your document and what it needs to cover',
  inputPlaceholder:
    'Services contract between my design studio and a Series B SaaS client for a 6-month engagement at $18K/month, governed by Australian law…',
  buttonLabel: 'Check my legal document',
  expertise: 'commercial lawyer and general counsel experienced across multiple jurisdictions',
  criteria: [
    { key: 'scopeClarity',        label: 'Scope clarity',           weight: 0.20, description: 'Parties, services, deliverables, and terms are unambiguous' },
    { key: 'riskBalance',         label: 'Risk balance',            weight: 0.20, description: 'Liability and indemnity allocated appropriately' },
    { key: 'enforceability',      label: 'Enforceability',          weight: 0.15, description: 'Clauses likely to stand up in the chosen jurisdiction' },
    { key: 'completeness',        label: 'Completeness',            weight: 0.15, description: 'No critical clauses missing for this contract type' },
    { key: 'termination',         label: 'Exit terms',              weight: 0.15, description: 'Termination, notice, and post-termination rights' },
    { key: 'compliance',          label: 'Compliance posture',       weight: 0.15, description: 'Aligned with applicable laws and regulations' },
  ],
};

const TECHNICAL_RUBRIC: ValidationRubric = {
  intro:
    'Describe the technical document — product, audience, and the problem it solves for readers. We\'ll assess whether it matches developer needs and how discoverable it will be.',
  inputLabel: 'Your technical doc idea',
  inputPlaceholder:
    'A getting-started guide for developers integrating Lunar\'s analytical database. Target reader: backend engineers with Postgres experience…',
  buttonLabel: 'Validate my technical doc',
  expertise: 'staff-level technical writer at a developer-tools company, with deep DX instincts',
  criteria: [
    { key: 'audienceClarity',     label: 'Audience clarity',        weight: 0.20, description: 'Right-sized for the reader\'s skill level' },
    { key: 'taskRelevance',       label: 'Task relevance',          weight: 0.20, description: 'Solves the top jobs-to-be-done for this audience' },
    { key: 'technicalAccuracy',   label: 'Technical accuracy',      weight: 0.15, description: 'Content can be made factually correct' },
    { key: 'completeness',        label: 'Completeness',            weight: 0.15, description: 'Scope covers the critical paths without bloat' },
    { key: 'discoverability',     label: 'Discoverability',         weight: 0.15, description: 'SEO and findability in docs and search' },
    { key: 'maintainability',     label: 'Maintainability',         weight: 0.15, description: 'Doc design is sustainable as the product evolves' },
  ],
};

const REFERENCE_RUBRIC: ValidationRubric = {
  intro:
    'Describe your cookbook or guide idea — the subject, audience, and hook. We\'ll assess how well it stands out in a crowded genre and who will reach for it again and again.',
  inputLabel: 'Your idea',
  inputPlaceholder:
    'A cookbook of 50 one-pot weeknight dinners for working parents, focused on 30-minute meals with pantry staples…',
  buttonLabel: 'Validate my idea',
  expertise: 'cookbook editor and food writer who has shipped bestsellers in the trade',
  criteria: [
    { key: 'audienceClarity',     label: 'Audience clarity',        weight: 0.20, description: 'The person who buys this is obvious' },
    { key: 'uniqueAngle',         label: 'Unique angle',            weight: 0.20, description: 'Hook that separates it from existing titles' },
    { key: 'repeatUse',           label: 'Repeat-use value',        weight: 0.15, description: 'Readers will return to it across the year' },
    { key: 'giftability',         label: 'Giftability',             weight: 0.15, description: 'Works as a gift — matters for trade sales' },
    { key: 'scopeDepth',          label: 'Scope / depth',           weight: 0.15, description: 'Right number of entries; right level of detail' },
    { key: 'authorAuthority',     label: 'Author authority',        weight: 0.15, description: 'Believable expertise behind the claims' },
  ],
};

const SHORT_FORM_RUBRIC: ValidationRubric = {
  intro:
    'Describe the piece — theme, form, voice. We\'ll assess craft potential and where it could land for publication.',
  inputLabel: 'Your idea',
  inputPlaceholder:
    'A collection of 40 free-verse poems about migration, told through three generations of women in one family…',
  buttonLabel: 'Validate my idea',
  expertise: 'literary editor and contest judge for small-press and literary magazines',
  criteria: [
    { key: 'originality',        label: 'Originality',              weight: 0.25, description: 'Fresh language, image, or form' },
    { key: 'emotionalCore',      label: 'Emotional core',           weight: 0.20, description: 'Clear emotional stake for the reader' },
    { key: 'craftPotential',     label: 'Craft potential',          weight: 0.20, description: 'The material supports strong formal execution' },
    { key: 'audienceReach',      label: 'Audience reach',           weight: 0.10, description: 'Readers beyond the writer\'s immediate circle' },
    { key: 'publicationFit',     label: 'Publication venue fit',    weight: 0.15, description: 'Matches identifiable literary outlets' },
    { key: 'voiceConsistency',   label: 'Voice consistency',        weight: 0.10, description: 'The voice holds across the full piece' },
  ],
};

const CONTENT_TYPE_RUBRIC: Partial<Record<ContentType, ValidationRubric>> = {
  'non-fiction':      NARRATIVE_RUBRIC,
  'fiction':          NARRATIVE_RUBRIC,
  'memoir':           NARRATIVE_RUBRIC,
  'self-help':        NARRATIVE_RUBRIC,
  'biography':        NARRATIVE_RUBRIC,
  'children':         NARRATIVE_RUBRIC,
  'travel':           NARRATIVE_RUBRIC,
  'essay_collection': NARRATIVE_RUBRIC,
  'book':             NARRATIVE_RUBRIC,
  'business':         NARRATIVE_RUBRIC,

  'business_plan':    BUSINESS_PLAN_RUBRIC,
  'proposal':         PROPOSAL_RUBRIC,
  'pitch_deck':       PROPOSAL_RUBRIC,
  'white_paper':      BUSINESS_PLAN_RUBRIC,
  'financial_model':  BUSINESS_PLAN_RUBRIC,
  'report':           PROPOSAL_RUBRIC,

  'paper':            ACADEMIC_RUBRIC,
  'research_paper':   ACADEMIC_RUBRIC,
  'academic':         ACADEMIC_RUBRIC,
  'thesis':           ACADEMIC_RUBRIC,
  'dissertation':     ACADEMIC_RUBRIC,
  'educational':      ACADEMIC_RUBRIC,

  'contract':         LEGAL_RUBRIC,
  'nda':              LEGAL_RUBRIC,
  'terms_of_service': LEGAL_RUBRIC,
  'privacy_policy':   LEGAL_RUBRIC,
  'policy_document':  LEGAL_RUBRIC,
  'policy':           LEGAL_RUBRIC,
  'legal_brief':      LEGAL_RUBRIC,

  'technical':        TECHNICAL_RUBRIC,
  'technical_doc':    TECHNICAL_RUBRIC,
  'api_docs':         TECHNICAL_RUBRIC,
  'user_manual':      TECHNICAL_RUBRIC,
  'specification':    TECHNICAL_RUBRIC,

  'cookbook':         REFERENCE_RUBRIC,

  'poetry':           SHORT_FORM_RUBRIC,
  'short_story':      SHORT_FORM_RUBRIC,
  'screenplay':       SHORT_FORM_RUBRIC,
};

const FLAVOR_RUBRIC_FALLBACK: Record<DocumentFlavor, ValidationRubric> = {
  narrative:     NARRATIVE_RUBRIC,
  instructional: NARRATIVE_RUBRIC,
  academic:      ACADEMIC_RUBRIC,
  business:      BUSINESS_PLAN_RUBRIC,
  legal:         LEGAL_RUBRIC,
  technical:     TECHNICAL_RUBRIC,
  reference:     REFERENCE_RUBRIC,
  short_form:    SHORT_FORM_RUBRIC,
};

/**
 * Returns the validation rubric for a given content type. Falls back to
 * the document flavor's rubric, then to the narrative default.
 */
export function getValidationRubric(contentType: string | null | undefined): ValidationRubric {
  if (contentType && CONTENT_TYPE_RUBRIC[contentType as ContentType]) {
    return CONTENT_TYPE_RUBRIC[contentType as ContentType]!;
  }
  const template = getTemplate(contentType);
  return FLAVOR_RUBRIC_FALLBACK[template.flavor] || NARRATIVE_RUBRIC;
}
