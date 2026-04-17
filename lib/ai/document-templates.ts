/**
 * Document structure templates per content type.
 *
 * Every content type declares:
 *   - `sections`    the canonical section list it should produce
 *   - `wordsTarget` per-section target (fiction chapter ≠ legal clause)
 *   - `flavor`      how the writing agent should approach prose
 *   - `requiresCitations` hard constraint — if true, no uncited claims allowed
 *
 * This is the single source of truth used by the outline endpoint and the
 * writing pipeline. Both agents now read from here instead of hard-coding
 * 8 chapters of 5k words for every document type.
 */

export type DocumentFlavor =
  | 'narrative'       // chapter-based storytelling; fiction, memoir, non-fiction book
  | 'instructional'   // how-to, self-help; sections with exercises
  | 'academic'        // paper, thesis, dissertation; IMRaD-like, citations mandatory
  | 'business'        // business plan, proposal, pitch; executive summary + analysis
  | 'legal'           // contract, NDA, policy; clauses, defined terms, no citations
  | 'technical'       // docs, spec, API; sections with code, reference tables
  | 'reference'       // cookbook, travel guide; discrete entries
  | 'short_form';     // short story, poem, essay — no sections, single flowing piece

export interface DocumentSection {
  key: string;                       // stable ID used across runs
  label: string;                     // display label (e.g. "Literature Review")
  description: string;               // tells the writing agent what goes in this section
  required: boolean;                 // if false, outline agent may omit based on brief
  minWords: number;
  maxWords: number;
  keyPoints?: number;                // suggested number of key points (0 for prose flow)
}

export interface DocumentTemplate {
  flavor: DocumentFlavor;
  /** Whether the number of body sections is fixed (e.g. academic paper has
   *  fixed IMRaD) or variable (non-fiction book has N chapters). */
  bodyIsVariable: boolean;
  /** If bodyIsVariable, these apply per body section. */
  bodyLabelSingular: string;         // "Chapter", "Section", "Clause", "Recipe"
  bodyLabelPlural: string;
  bodyMinWords: number;
  bodyMaxWords: number;
  bodyKeyPoints: number;
  /** Canonical frame. Body sections are inserted between front and back. */
  frontMatter: DocumentSection[];
  backMatter: DocumentSection[];
  /** For fixed-body-structure types (like academic papers) — the full
   *  sequential structure. bodyIsVariable=false uses this. */
  fixedBody?: DocumentSection[];
  /** Hard requirements the writing agent must respect. */
  requiresCitations: boolean;
  allowsHallucination: false;        // always false — just an explicit marker
  /** Extra instructions to feed to both outline + writing agents. */
  writingStyleGuide: string;
}

// =============================================================================
// NON-FICTION BOOK / SELF-HELP / MEMOIR / BIOGRAPHY / FICTION
// -> narrative flavor, variable chapters, ~4k words per chapter
// =============================================================================

const narrativeBook: DocumentTemplate = {
  flavor: 'narrative',
  bodyIsVariable: true,
  bodyLabelSingular: 'Chapter',
  bodyLabelPlural: 'Chapters',
  bodyMinWords: 3000,
  bodyMaxWords: 5000,
  bodyKeyPoints: 5,
  frontMatter: [
    {
      key: 'introduction',
      label: 'Introduction',
      description: 'Hook the reader. State the promise of the book. Establish authority and relevance.',
      required: true,
      minWords: 1000,
      maxWords: 2500,
    },
  ],
  backMatter: [
    {
      key: 'conclusion',
      label: 'Conclusion',
      description: 'Synthesise the key ideas. Issue a call to action. Leave the reader with a memorable final thought.',
      required: true,
      minWords: 1000,
      maxWords: 2500,
    },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Write in the author's voice. Use clear prose with short paragraphs. Open each chapter with a story, quote, or provocative question. Include concrete examples. End each chapter with a natural transition.`,
};

// =============================================================================
// BUSINESS PLAN / PROPOSAL / WHITE PAPER / PITCH DECK / REPORT
// -> fixed-structure business documents
// =============================================================================

const businessPlan: DocumentTemplate = {
  flavor: 'business',
  bodyIsVariable: false,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 500,
  bodyMaxWords: 2000,
  bodyKeyPoints: 4,
  frontMatter: [],
  backMatter: [],
  fixedBody: [
    { key: 'exec_summary',     label: 'Executive Summary',          description: 'One-page snapshot: problem, solution, market, team, traction, ask.', required: true, minWords: 400,  maxWords: 800 },
    { key: 'company',          label: 'Company Description',        description: 'Mission, vision, legal structure, location, milestones.',         required: true, minWords: 300,  maxWords: 800 },
    { key: 'market',           label: 'Market Analysis',            description: 'TAM/SAM/SOM, segmentation, trends, competitive landscape with sources.', required: true, minWords: 800,  maxWords: 2000 },
    { key: 'product',          label: 'Products & Services',        description: 'What you sell, pricing, differentiation, roadmap.',               required: true, minWords: 500,  maxWords: 1500 },
    { key: 'go_to_market',     label: 'Marketing & Sales Strategy', description: 'Channels, customer acquisition cost, funnel, partnerships.',      required: true, minWords: 500,  maxWords: 1500 },
    { key: 'operations',       label: 'Operations Plan',            description: 'Supply chain, staffing, facilities, technology, compliance.',      required: true, minWords: 400,  maxWords: 1200 },
    { key: 'management',       label: 'Management Team',            description: 'Founders and key hires. Gaps and hiring plan.',                   required: true, minWords: 300,  maxWords: 800 },
    { key: 'financials',       label: 'Financial Projections',      description: '3-year P&L, cash flow, balance sheet. Funding requirements.',     required: true, minWords: 500,  maxWords: 1500 },
    { key: 'risk',             label: 'Risk Analysis',              description: 'Top 5 risks and mitigations.',                                    required: true, minWords: 300,  maxWords: 800 },
    { key: 'appendix',         label: 'Appendix',                   description: 'Supporting documents, CVs, technical specs, source citations.',   required: false, minWords: 200,  maxWords: 1500 },
  ],
  requiresCitations: true,
  allowsHallucination: false,
  writingStyleGuide: `Write in a confident, investor-ready tone. Back every market claim with a cited source (industry report, government statistic, peer-reviewed study). Use bullet points, tables, and numbered lists. Avoid speculative language.`,
};

const proposal: DocumentTemplate = {
  flavor: 'business',
  bodyIsVariable: false,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 400,
  bodyMaxWords: 1500,
  bodyKeyPoints: 3,
  frontMatter: [],
  backMatter: [],
  fixedBody: [
    { key: 'summary',       label: 'Executive Summary',    description: 'One-page summary of the problem, approach, and outcome.',      required: true, minWords: 300, maxWords: 600 },
    { key: 'problem',       label: 'Problem Statement',    description: 'Precise definition of the client\'s problem with evidence.',  required: true, minWords: 400, maxWords: 1000 },
    { key: 'approach',      label: 'Proposed Approach',    description: 'Step-by-step solution. Methodology. Deliverables.',           required: true, minWords: 500, maxWords: 1500 },
    { key: 'timeline',      label: 'Timeline & Milestones', description: 'Phased schedule with specific dates and owners.',            required: true, minWords: 300, maxWords: 800 },
    { key: 'team',          label: 'Team & Qualifications', description: 'Who will do the work. Relevant past outcomes.',              required: true, minWords: 300, maxWords: 800 },
    { key: 'pricing',       label: 'Investment / Pricing', description: 'Detailed cost breakdown. Payment schedule.',                   required: true, minWords: 200, maxWords: 600 },
    { key: 'next_steps',    label: 'Next Steps',           description: 'Clear call to action with decision deadlines.',               required: true, minWords: 150, maxWords: 400 },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Direct, client-focused, second-person ("you"). Emphasise outcomes over features. Use concrete numbers and deadlines.`,
};

const whitePaper: DocumentTemplate = {
  flavor: 'business',
  bodyIsVariable: false,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 500,
  bodyMaxWords: 2000,
  bodyKeyPoints: 4,
  frontMatter: [],
  backMatter: [],
  fixedBody: [
    { key: 'summary',     label: 'Executive Summary',   description: 'Key findings and recommendations in 300 words or fewer.',            required: true, minWords: 250, maxWords: 500 },
    { key: 'intro',       label: 'Introduction',        description: 'Context, scope, and why this matters now.',                          required: true, minWords: 500, maxWords: 1000 },
    { key: 'background',  label: 'Background & Context', description: 'Industry context, historical framing, existing solutions.',        required: true, minWords: 800, maxWords: 2000 },
    { key: 'problem',     label: 'The Problem',         description: 'Detailed analysis with data points and cited sources.',              required: true, minWords: 800, maxWords: 2000 },
    { key: 'solution',    label: 'The Solution',        description: 'Proposed solution with evidence and comparative analysis.',          required: true, minWords: 1000, maxWords: 2500 },
    { key: 'case_study',  label: 'Case Study',          description: 'Real-world example or hypothetical scenario showing the solution in action.', required: false, minWords: 400, maxWords: 1200 },
    { key: 'conclusion',  label: 'Conclusion & Recommendations', description: 'Synthesis and concrete next steps.',                       required: true, minWords: 400, maxWords: 1000 },
    { key: 'references',  label: 'References',          description: 'Full citations in the author\'s chosen style.',                      required: true, minWords: 100, maxWords: 2000 },
  ],
  requiresCitations: true,
  allowsHallucination: false,
  writingStyleGuide: `Authoritative, research-backed, third-person. Every factual claim requires a citation. Use tables and diagrams references where appropriate.`,
};

// =============================================================================
// ACADEMIC: THESIS, DISSERTATION, RESEARCH PAPER, ACADEMIC PAPER
// -> strict IMRaD or variant; citations mandatory
// =============================================================================

const researchPaper: DocumentTemplate = {
  flavor: 'academic',
  bodyIsVariable: false,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 500,
  bodyMaxWords: 2500,
  bodyKeyPoints: 3,
  frontMatter: [
    { key: 'abstract', label: 'Abstract', description: 'Structured abstract: background, methods, results, conclusions. Max 250 words.', required: true, minWords: 150, maxWords: 300 },
    { key: 'keywords', label: 'Keywords', description: '4–8 keywords for indexing.', required: true, minWords: 10, maxWords: 50 },
  ],
  backMatter: [
    { key: 'references', label: 'References', description: 'Complete reference list in the chosen citation style (APA/Vancouver/MLA/Chicago/Harvard/IEEE). Every in-text citation must appear here.', required: true, minWords: 200, maxWords: 5000 },
  ],
  fixedBody: [
    { key: 'introduction',   label: 'Introduction',            description: 'Research gap, objective, hypotheses. Cite prior art.',                        required: true, minWords: 800, maxWords: 2000 },
    { key: 'literature',     label: 'Literature Review',       description: 'Critical synthesis of prior work. Every claim cited. Identify the gap this paper fills.', required: true, minWords: 1500, maxWords: 5000 },
    { key: 'methodology',    label: 'Methodology',             description: 'Research design, participants, instruments, procedure, analysis plan. Reproducible detail.', required: true, minWords: 1000, maxWords: 3000 },
    { key: 'results',        label: 'Results',                 description: 'Findings only — no interpretation. Tables and figures referenced.',             required: true, minWords: 800, maxWords: 3000 },
    { key: 'discussion',     label: 'Discussion',              description: 'Interpretation. Comparison with prior work. Limitations. Implications.',        required: true, minWords: 1000, maxWords: 3000 },
    { key: 'conclusion',     label: 'Conclusion',              description: 'Summary of contribution. Future work.',                                         required: true, minWords: 300, maxWords: 800 },
  ],
  requiresCitations: true,
  allowsHallucination: false,
  writingStyleGuide: `Strict academic register. Third-person passive where appropriate. No claims without citations. No statistics without source. No quotes without page numbers. Use the author's chosen citation style consistently.`,
};

const thesis: DocumentTemplate = {
  ...researchPaper,
  bodyIsVariable: false,
  bodyMinWords: 3000,
  bodyMaxWords: 15000,
  fixedBody: [
    { key: 'introduction',     label: 'Introduction',           description: 'Context, problem, significance, objectives, research questions.',          required: true, minWords: 2000, maxWords: 5000 },
    { key: 'literature',       label: 'Literature Review',      description: 'Comprehensive synthesis. Identify theoretical framework and gap.',         required: true, minWords: 5000, maxWords: 15000 },
    { key: 'methodology',      label: 'Methodology',            description: 'Research paradigm, design, data collection, analysis, ethics, limitations.', required: true, minWords: 3000, maxWords: 8000 },
    { key: 'results',          label: 'Results / Findings',     description: 'Presentation of empirical findings.',                                        required: true, minWords: 3000, maxWords: 10000 },
    { key: 'discussion',       label: 'Discussion',             description: 'Interpretation relative to literature. Theoretical and practical implications.', required: true, minWords: 3000, maxWords: 8000 },
    { key: 'conclusion',       label: 'Conclusion',             description: 'Synthesis, contributions to knowledge, recommendations, future research.',   required: true, minWords: 1500, maxWords: 4000 },
  ],
  frontMatter: [
    { key: 'abstract',         label: 'Abstract',               description: 'Max 350 words covering problem, methods, findings, contribution.', required: true, minWords: 200, maxWords: 400 },
    { key: 'acknowledgements', label: 'Acknowledgements',       description: 'Supervisors, participants, funding, support.',                      required: false, minWords: 50,  maxWords: 500 },
  ],
};

// =============================================================================
// LEGAL: CONTRACT / NDA / TERMS / POLICY
// =============================================================================

const contract: DocumentTemplate = {
  flavor: 'legal',
  bodyIsVariable: false,
  bodyLabelSingular: 'Clause',
  bodyLabelPlural: 'Clauses',
  bodyMinWords: 100,
  bodyMaxWords: 800,
  bodyKeyPoints: 2,
  frontMatter: [
    { key: 'parties',  label: 'Parties',          description: 'Full legal names and addresses.',     required: true, minWords: 50, maxWords: 300 },
    { key: 'recitals', label: 'Recitals (Whereas)', description: 'Background context.',               required: false, minWords: 100, maxWords: 500 },
  ],
  backMatter: [
    { key: 'signatures', label: 'Signatures', description: 'Signature blocks for all parties.', required: true, minWords: 50, maxWords: 200 },
  ],
  fixedBody: [
    { key: 'definitions',    label: 'Definitions',             description: 'Defined terms used throughout.',               required: true,  minWords: 200, maxWords: 1000 },
    { key: 'scope',          label: 'Scope of Agreement',      description: 'What is being agreed.',                        required: true,  minWords: 200, maxWords: 800 },
    { key: 'obligations',    label: 'Obligations of the Parties', description: 'Duties of each party.',                     required: true,  minWords: 300, maxWords: 1500 },
    { key: 'payment',        label: 'Payment Terms',           description: 'Fees, schedule, invoicing.',                   required: false, minWords: 150, maxWords: 800 },
    { key: 'term',           label: 'Term and Termination',    description: 'Duration. Termination rights and procedure.',  required: true,  minWords: 150, maxWords: 600 },
    { key: 'confidentiality', label: 'Confidentiality',        description: 'Confidential information handling.',           required: false, minWords: 200, maxWords: 800 },
    { key: 'ip',             label: 'Intellectual Property',   description: 'Ownership and licensing of IP.',               required: false, minWords: 200, maxWords: 800 },
    { key: 'warranties',     label: 'Warranties & Indemnities', description: 'Representations, warranties, and indemnities.', required: true, minWords: 200, maxWords: 1000 },
    { key: 'liability',      label: 'Limitation of Liability', description: 'Liability caps and exclusions.',               required: true,  minWords: 150, maxWords: 600 },
    { key: 'dispute',        label: 'Dispute Resolution',      description: 'Governing law. Venue. Arbitration/mediation.', required: true,  minWords: 150, maxWords: 500 },
    { key: 'general',        label: 'General Provisions',      description: 'Assignment, severability, entire agreement, notices.', required: true, minWords: 200, maxWords: 800 },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Formal legal register. Use numbered clauses (e.g. 1., 1.1., 1.1.1). Defined terms in Title Case, referenced exactly as defined. Clear, unambiguous language. No marketing tone. Include a disclaimer in the generated document recommending review by a qualified lawyer.`,
};

// =============================================================================
// TECHNICAL: TECHNICAL DOC / API DOCS / USER MANUAL / SPECIFICATION
// =============================================================================

const technicalDoc: DocumentTemplate = {
  flavor: 'technical',
  bodyIsVariable: true,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 500,
  bodyMaxWords: 2500,
  bodyKeyPoints: 4,
  frontMatter: [
    { key: 'overview',     label: 'Overview',          description: 'What this documents, who it is for, and prerequisites.', required: true, minWords: 300, maxWords: 800 },
    { key: 'quickstart',   label: 'Quick Start',       description: '5-minute path to a working example.',                     required: false, minWords: 300, maxWords: 1000 },
  ],
  backMatter: [
    { key: 'glossary',     label: 'Glossary',          description: 'Key technical terms.',                       required: false, minWords: 100, maxWords: 1500 },
    { key: 'changelog',    label: 'Changelog',         description: 'Version history.',                           required: false, minWords: 50,  maxWords: 1000 },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Clear, imperative voice. Show working code blocks with language tags. Every example must be complete and runnable. Use callouts (Note:, Warning:) sparingly. Tables for reference material.`,
};

// =============================================================================
// REFERENCE: COOKBOOK / TRAVEL GUIDE / CHILDREN'S BOOK
// =============================================================================

const cookbook: DocumentTemplate = {
  flavor: 'reference',
  bodyIsVariable: true,
  bodyLabelSingular: 'Recipe',
  bodyLabelPlural: 'Recipes',
  bodyMinWords: 400,
  bodyMaxWords: 1200,
  bodyKeyPoints: 3,
  frontMatter: [
    { key: 'introduction', label: 'Introduction', description: 'Author\'s connection to the cuisine. Philosophy behind the book.', required: true, minWords: 500, maxWords: 1500 },
    { key: 'essentials',   label: 'Kitchen Essentials', description: 'Must-have tools, pantry staples, techniques to master first.', required: false, minWords: 500, maxWords: 2000 },
  ],
  backMatter: [
    { key: 'index', label: 'Index', description: 'Alphabetical list of recipes and key ingredients.', required: false, minWords: 100, maxWords: 1000 },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Warm, inviting prose. Each recipe has: headnote (story/context), ingredient list, numbered instructions, serving suggestion. Specify exact quantities with both metric and imperial.`,
};

// =============================================================================
// SHORT FORM: SHORT STORY, POETRY, ESSAY COLLECTION, SCREENPLAY
// =============================================================================

const shortStory: DocumentTemplate = {
  flavor: 'short_form',
  bodyIsVariable: false,
  bodyLabelSingular: 'Section',
  bodyLabelPlural: 'Sections',
  bodyMinWords: 2000,
  bodyMaxWords: 10000,
  bodyKeyPoints: 0,
  frontMatter: [],
  backMatter: [],
  fixedBody: [
    { key: 'story', label: 'Story', description: 'The complete short story.', required: true, minWords: 2000, maxWords: 10000 },
  ],
  requiresCitations: false,
  allowsHallucination: false,
  writingStyleGuide: `Show, don't tell. Strong opening. Character-driven. Economical prose. Leave the reader thinking.`,
};

const poetry: DocumentTemplate = {
  ...shortStory,
  bodyLabelSingular: 'Poem',
  bodyLabelPlural: 'Poems',
  bodyMinWords: 50,
  bodyMaxWords: 500,
  bodyIsVariable: true,
  fixedBody: undefined,
  writingStyleGuide: `Vivid imagery. Sound matters. Line breaks purposeful.`,
};

// =============================================================================
// MAIN REGISTRY
// =============================================================================

const DEFAULT_TEMPLATE = narrativeBook;

/**
 * Content type → template. Unknown types fall back to narrativeBook.
 */
export const DOCUMENT_TEMPLATES: Record<string, DocumentTemplate> = {
  // Books
  'non-fiction':   narrativeBook,
  'fiction':       narrativeBook,
  'self-help':     narrativeBook,
  'memoir':        narrativeBook,
  'biography':     narrativeBook,
  'children':      narrativeBook,
  'book':          narrativeBook,
  'travel':        narrativeBook,

  // Business
  'business_plan':     businessPlan,
  'proposal':          proposal,
  'white_paper':       whitePaper,
  'pitch_deck':        proposal,        // similar shape
  'financial_model':   whitePaper,
  'report':            whitePaper,
  'business':          narrativeBook,   // full business book

  // Academic
  'paper':             researchPaper,
  'research_paper':    researchPaper,
  'academic':          researchPaper,
  'thesis':            thesis,
  'dissertation':      thesis,
  'educational':       technicalDoc,

  // Legal
  'contract':          contract,
  'nda':               contract,
  'terms_of_service':  contract,
  'privacy_policy':    contract,
  'policy_document':   contract,
  'policy':            contract,
  'legal_brief':       whitePaper,

  // Technical
  'technical':         narrativeBook,
  'technical_doc':     technicalDoc,
  'api_docs':          technicalDoc,
  'user_manual':       technicalDoc,
  'specification':     technicalDoc,

  // Reference
  'cookbook':          cookbook,

  // Creative short form
  'poetry':            poetry,
  'short_story':       shortStory,
  'screenplay':        shortStory,
  'essay_collection':  narrativeBook,
};

export function getTemplate(contentType: string | null | undefined): DocumentTemplate {
  if (!contentType) return DEFAULT_TEMPLATE;
  return DOCUMENT_TEMPLATES[contentType] || DEFAULT_TEMPLATE;
}

/**
 * Citation styles available when a document requires citations. The user picks
 * one during the follow-up step; research/outline/writing agents all honor it.
 */
export const CITATION_STYLES = [
  { id: 'apa',       label: 'APA 7th',     example: '(Smith, 2023)' },
  { id: 'vancouver', label: 'Vancouver',   example: '[1]' },
  { id: 'mla',       label: 'MLA 9th',     example: '(Smith 42)' },
  { id: 'chicago',   label: 'Chicago',     example: '(Smith 2023, 42)' },
  { id: 'harvard',   label: 'Harvard',     example: '(Smith, 2023, p. 42)' },
  { id: 'ieee',      label: 'IEEE',        example: '[1]' },
] as const;

export type CitationStyleId = typeof CITATION_STYLES[number]['id'];
