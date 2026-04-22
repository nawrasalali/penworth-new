-- =========================================================================
-- CEO-033 follow-on: seed interview_prompts for paper, academic, poetry.
-- Founder directive 2026-04-23: "Every interview must be specific to the
-- document type." These three have live projects in production and were
-- previously getting fallback mappings (poetry -> fiction; paper/academic
-- -> proposal), which are wrong. A research paper is not a proposal. A
-- humanities essay is not a PhD proposal. A poetry collection has no
-- relationship to fiction craft at all.
--
-- Also updates resolve_interview_prompt() to route these three direct.
-- =========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- paper : academic research paper (empirical / theoretical / review / etc.)
-- Contribution is COMPLETE; this is a publishable write-up, not a plan.
-- Peer-reviewable. Shorter than a thesis chapter but denser than a proposal.
-- ---------------------------------------------------------------------------
INSERT INTO public.interview_prompts
  (document_type, version, is_active,
   system_prompt, opening_prompt_template,
   question_bank, completion_criteria, output_schema, notes)
VALUES (
  'paper', 1, true,
  -- system_prompt
  $sp$You are the Interviewer conducting an intake for a publishable academic research paper — a complete, standalone contribution to a field's literature.

This is different from a thesis (one chapter of a larger work) and from a proposal (research not yet done). The author has already generated findings; your job is to surface what the paper CLAIMS, what it CONTRIBUTES, and what it needs to survive peer review.

Be precise and collegial. Ask uncomfortable questions about methodology, contribution, and limitations — the reviewer will. Adapt to the author's discipline (methods sections in biomedicine differ from those in political science; humanities papers foreground argument rather than experiment). Never let the author leave contribution or methodology vague. If the author is in a quantitative field, push for sample sizes and effect magnitudes. If qualitative, push for number of interviews, coding approach, transparency.

Walk the question_bank in order, but pivot when the author's answer opens a better question. Accept mc_choice_id, free text, or both (answer_type = "mc" | "free" | "mc_plus_free"). Mark skipped=true if the author chooses to skip a skippable question. Do not allow non_skippable questions to be skipped; re-ask in a gentler form instead.

Emit {approved:true, sections:[...], document_type, sections_count, interview_version} ONLY when (a) non-skipped sections >= min_required_answers AND (b) every non_skippable_question_id has a non-skipped entry in sections.$sp$,
  -- opening_prompt_template
  $op$You're writing a research paper on: **{{validation_data.chosenTopic}}**.

{{validation_data.score.summary}}

Let's make sure every element a reviewer will check for is sharp before we outline. I'll ask about your discipline, your research question, your methods, your findings, and your contribution — in that order. Expect me to push on specifics: sample sizes, mechanisms, prior literature you're in dialogue with, and limitations you're honest about.

Ready?$op$,
  -- question_bank
  $qb$[
    {
      "id": "discipline",
      "category": "context",
      "required": true,
      "question_text": "What discipline is this paper for? The conventions around methods, citations, and contribution vary enormously.",
      "accepts_free_text": true,
      "notes": "Discipline governs everything downstream — methods sections, citation density, even paragraph length. Nail this first.",
      "mc_options": [
        {"id": "biomed", "label": "Biomedical / clinical / life sciences"},
        {"id": "natural_science", "label": "Natural sciences (physics, chemistry, earth)"},
        {"id": "engineering", "label": "Engineering / computer science"},
        {"id": "social_science_quant", "label": "Social sciences — quantitative (economics, psych, poli sci)"},
        {"id": "social_science_qual", "label": "Social sciences — qualitative (sociology, anthropology, ethnography)"},
        {"id": "humanities", "label": "Humanities (history, literature, philosophy, area studies)"},
        {"id": "interdisciplinary", "label": "Interdisciplinary — spans two or more of the above"},
        {"id": "other", "label": "Something else — I'll describe", "is_free_text": true}
      ]
    },
    {
      "id": "paper_type",
      "category": "context",
      "required": true,
      "question_text": "What kind of paper is this? The structure depends on which.",
      "accepts_free_text": true,
      "notes": "Empirical papers have IMRaD. Review papers are thematic. Theoretical papers build arguments. Methods papers justify a new tool. Guide the outline agent differently for each.",
      "mc_options": [
        {"id": "empirical", "label": "Empirical — I ran a study and report results"},
        {"id": "theoretical", "label": "Theoretical — I develop a concept, model, or argument"},
        {"id": "review", "label": "Review — I synthesize the existing literature on a topic"},
        {"id": "methods", "label": "Methods — I propose or validate a new technique"},
        {"id": "case_study", "label": "Case study — I analyze one or a few instances in depth"},
        {"id": "commentary", "label": "Commentary / perspective — I argue for a position in the field"},
        {"id": "replication", "label": "Replication or null result"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "research_question",
      "category": "claim",
      "required": true,
      "question_text": "State your research question in one sentence. Not the topic — the actual question the paper answers.",
      "accepts_free_text": true,
      "notes": "If the author can't state it in one sentence, the paper isn't ready. Push back. A question has a question mark or an implicit one.",
      "mc_options": [
        {"id": "causal", "label": "Causal — does X cause Y?", "prefix": "Does "},
        {"id": "descriptive", "label": "Descriptive — what is the pattern of X?", "prefix": "What is the pattern of "},
        {"id": "normative", "label": "Normative — should X be the case?", "prefix": "Should "},
        {"id": "comparative", "label": "Comparative — how does X differ from Y?", "prefix": "How does "},
        {"id": "methodological", "label": "Methodological — how should we measure/study X?", "prefix": "How should we study "},
        {"id": "mechanism", "label": "Mechanism — why does X produce Y?", "prefix": "Why does "},
        {"id": "other", "label": "Something else — I'll write the question", "is_free_text": true}
      ]
    },
    {
      "id": "contribution",
      "category": "claim",
      "required": true,
      "question_text": "What does this paper contribute that prior work did not? One sentence, sharp.",
      "accepts_free_text": true,
      "notes": "Reviewer's first question. If contribution is vague, the paper gets desk-rejected. The MC picks the SHAPE; free text is the actual contribution.",
      "mc_options": [
        {"id": "new_finding", "label": "A new empirical finding — not previously reported"},
        {"id": "new_method", "label": "A new method, model, or measurement tool"},
        {"id": "new_synthesis", "label": "A new synthesis — integrating findings across literatures"},
        {"id": "extension", "label": "An extension — prior findings replicated in a new context / population"},
        {"id": "replication", "label": "A replication — prior result confirmed or failed to replicate"},
        {"id": "contrarian", "label": "A contrarian finding — prior consensus is wrong or incomplete"},
        {"id": "theoretical", "label": "A theoretical contribution — new concept, framework, or argument"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "methodology",
      "category": "method",
      "required": true,
      "question_text": "How did you generate the findings (or, for non-empirical papers, how did you build the argument)?",
      "accepts_free_text": true,
      "notes": "For empirical papers, this unlocks IMRaD. For theoretical papers, this is about argumentative strategy. Force specifics.",
      "mc_options": [
        {"id": "quant_experimental", "label": "Quantitative — experiment / RCT / lab study"},
        {"id": "quant_observational", "label": "Quantitative — observational data, regression-based"},
        {"id": "quant_computational", "label": "Computational — simulation, modeling, or ML"},
        {"id": "qual_interview", "label": "Qualitative — interviews / focus groups"},
        {"id": "qual_ethno", "label": "Qualitative — ethnography / participant observation"},
        {"id": "qual_archival", "label": "Archival / historical — primary documents"},
        {"id": "mixed", "label": "Mixed methods — combination of the above"},
        {"id": "theoretical", "label": "Theoretical / argumentative — no new data; reasoning from established facts"},
        {"id": "review_systematic", "label": "Systematic review / meta-analysis"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "sample_or_scope",
      "category": "method",
      "required": true,
      "question_text": "What is the scope of what you studied? (Sample size, archive size, number of cases, time period covered.)",
      "accepts_free_text": true,
      "notes": "Reviewers check this. Make the author commit to specifics.",
      "mc_options": [
        {"id": "commit_numbers", "label": "I have concrete numbers — I'll describe (N, time period, scope)"},
        {"id": "not_yet_known", "label": "Not finalized yet — I need to nail it down"},
        {"id": "not_applicable", "label": "Not applicable — theoretical paper, no sample"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "key_finding",
      "category": "claim",
      "required": true,
      "question_text": "State your headline finding in one sentence. If someone reads only the abstract, what do they leave with?",
      "accepts_free_text": true,
      "notes": "This IS the paper. If unclear, outline will be unclear.",
      "mc_options": [
        {"id": "i_will_describe", "label": "I'll describe in my own words", "is_free_text": true}
      ]
    },
    {
      "id": "supporting_findings",
      "category": "claim",
      "required": false,
      "question_text": "What else did you find? Secondary results, moderators, boundary conditions, mechanism evidence.",
      "accepts_free_text": true,
      "notes": "These become subsections in Results. Optional but strengthens paper.",
      "mc_options": [
        {"id": "additional_effects", "label": "Additional effects beyond the headline"},
        {"id": "moderators", "label": "Moderators — when the effect is stronger/weaker"},
        {"id": "mechanism", "label": "Mechanism evidence — why the effect happens"},
        {"id": "boundary_conditions", "label": "Boundary conditions — where the effect doesn't hold"},
        {"id": "null_or_mixed", "label": "Null or mixed results on related questions"},
        {"id": "robustness", "label": "Robustness checks — the headline holds across specifications"},
        {"id": "none", "label": "Just the headline finding"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "literature_positioning",
      "category": "positioning",
      "required": true,
      "question_text": "Which 3-5 prior papers is this in direct conversation with? Name them, and say briefly how yours differs.",
      "accepts_free_text": true,
      "notes": "Rigour test. If the author can't name 3, they haven't read enough. Push back.",
      "mc_options": [
        {"id": "i_will_list", "label": "I'll list the papers and the difference", "is_free_text": true}
      ]
    },
    {
      "id": "limitations",
      "category": "integrity",
      "required": true,
      "question_text": "What are the real limitations of this paper? Where does a hostile reviewer attack first?",
      "accepts_free_text": true,
      "notes": "Authors who can't state limitations have papers that get rejected. Limitations section is non-optional in most venues.",
      "mc_options": [
        {"id": "sample_limits", "label": "Sample / data limitations (size, representativeness, selection)"},
        {"id": "measurement", "label": "Measurement issues — proxies, self-report, instrument validity"},
        {"id": "causal_inference", "label": "Causal inference limits — identification, confounding, endogeneity"},
        {"id": "scope", "label": "Scope — results may not generalize beyond specific context"},
        {"id": "theoretical_gaps", "label": "Theoretical gaps — one mechanism not tested, alternative explanations"},
        {"id": "multiple", "label": "Multiple — I'll describe them honestly"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "target_venue",
      "category": "positioning",
      "required": false,
      "question_text": "Where are you aiming to publish? This affects length, style, and formatting.",
      "accepts_free_text": true,
      "notes": "Top venues want sharper framing and tighter writing. Regional/field-specific give more room for context.",
      "mc_options": [
        {"id": "top_general", "label": "Top general-interest (Nature, Science, PNAS, AER, APSR)"},
        {"id": "field_leading", "label": "Field-leading specialized journal"},
        {"id": "mid_tier", "label": "Solid mid-tier journal in my field"},
        {"id": "conference", "label": "Major conference (CS / engineering)"},
        {"id": "edited_volume", "label": "Edited volume or handbook chapter"},
        {"id": "preprint_only", "label": "Preprint for now; venue later"},
        {"id": "not_decided", "label": "Haven't decided — help me think through it"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "implications",
      "category": "significance",
      "required": false,
      "question_text": "Who should care, and what should they do differently after reading this?",
      "accepts_free_text": true,
      "notes": "Becomes the Discussion section. Without it, papers feel pointless.",
      "mc_options": [
        {"id": "theoretical", "label": "Theoretical — changes how we think about this phenomenon"},
        {"id": "methodological", "label": "Methodological — other researchers should use this tool / approach"},
        {"id": "empirical", "label": "Empirical — other researchers should design studies addressing X"},
        {"id": "practical", "label": "Practical — practitioners should change behavior Y"},
        {"id": "policy", "label": "Policy — policymakers should consider Z"},
        {"id": "multi", "label": "A mix — I'll describe"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    }
  ]$qb$::jsonb,
  -- completion_criteria
  $cc${
    "min_required_answers": 9,
    "non_skippable_question_ids": [
      "discipline","paper_type","research_question","contribution","methodology",
      "sample_or_scope","key_finding","literature_positioning","limitations"
    ]
  }$cc$::jsonb,
  -- output_schema
  $os${
    "approved": "boolean",
    "sections": [
      {
        "question_id": "string",
        "question_text": "string",
        "answer_text": "string",
        "answer_type": "mc|free|mc_plus_free",
        "mc_choice_id": "string?",
        "voice_notes": "string[]?",
        "skipped": "boolean?"
      }
    ],
    "document_type": "paper",
    "sections_count": "int",
    "interview_version": "int"
  }$os$::jsonb,
  'Seeded 2026-04-23 per Founder directive: every interview must be specific. Paper differs from proposal (research done vs planned) and from thesis (standalone publishable vs chapter of larger work). 12 Q, min 9, 9 non-skippable.'
);

-- ---------------------------------------------------------------------------
-- academic : general academic writing (essay, lit review, book chapter,
-- critical analysis, theoretical argument, review article). NOT empirical.
-- Humanities and humanistic-social-science register. Argument-driven.
-- ---------------------------------------------------------------------------
INSERT INTO public.interview_prompts
  (document_type, version, is_active,
   system_prompt, opening_prompt_template,
   question_bank, completion_criteria, output_schema, notes)
VALUES (
  'academic', 1, true,
  -- system_prompt
  $sp$You are the Interviewer conducting an intake for an argument-driven academic work — an essay, literature review, book chapter, review article, or critical analysis. This is NOT an empirical paper. The contribution is an ARGUMENT, not a finding. The evidence is texts, archives, prior scholarship, or theoretical apparatus — not data from a study.

Your job is to surface the thesis, the method of analysis, the key texts the author is in dialogue with, and the stakes of the argument. Be a thesis supervisor in office hours: precise, collegial, unafraid to ask "so what?" if the author's argument seems predictable.

Ask about register (specialists vs. interdisciplinary vs. public), structure (linear vs. compare-contrast vs. genealogical), and counterarguments. Humanities readers expect attention to form; the author should be able to articulate why the piece is structured the way it is, not just what it says.

Walk question_bank in order, pivoting when the author's answer opens a sharper question. Accept mc_choice_id, free text, or both. Honour non_skippable_question_ids.

Emit {approved:true, sections:[...], document_type, sections_count, interview_version} when (a) non-skipped sections >= min_required_answers AND (b) every non_skippable_question_id has a non-skipped answer.$sp$,
  -- opening_prompt_template
  $op$You're writing an academic piece on: **{{validation_data.chosenTopic}}**.

{{validation_data.score.summary}}

Unlike an empirical paper, this is argument-driven — your job is to convince, not to demonstrate through new data. Let's sharpen the thesis, map the texts you're in dialogue with, and decide how the argument will unfold. I'll push on the "so what" — what changes for a reader who believes you?$op$,
  -- question_bank
  $qb$[
    {
      "id": "work_type",
      "category": "context",
      "required": true,
      "question_text": "What kind of academic piece is this? The form shapes everything — length, register, structure.",
      "accepts_free_text": true,
      "notes": "Essays want a sharp single argument. Lit reviews want synthetic mapping. Book chapters want more expansive argument with more context.",
      "mc_options": [
        {"id": "critical_essay", "label": "Critical essay — one argument, one sitting"},
        {"id": "literature_review", "label": "Literature review — synthesize and map a field"},
        {"id": "book_chapter", "label": "Book chapter — part of a larger monograph"},
        {"id": "review_article", "label": "Review article — extended critical assessment of a field/book/author"},
        {"id": "theoretical", "label": "Theoretical argument — advancing a concept or framework"},
        {"id": "commentary", "label": "Commentary / intervention — responding to recent scholarship"},
        {"id": "lecture", "label": "Lecture or keynote text"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "discipline",
      "category": "context",
      "required": true,
      "question_text": "What discipline or subfield? Conventions and reference points differ.",
      "accepts_free_text": true,
      "notes": "History writes differently from philosophy writes differently from literary criticism. Nail this.",
      "mc_options": [
        {"id": "literary_criticism", "label": "Literary / cultural criticism"},
        {"id": "history", "label": "History"},
        {"id": "philosophy", "label": "Philosophy"},
        {"id": "political_theory", "label": "Political theory / political philosophy"},
        {"id": "sociology_qual", "label": "Qualitative sociology / cultural sociology"},
        {"id": "anthropology", "label": "Anthropology / cultural studies"},
        {"id": "area_studies", "label": "Area studies (regional, religious, ethnic studies)"},
        {"id": "media_studies", "label": "Media / film / communication studies"},
        {"id": "interdisciplinary_humanities", "label": "Interdisciplinary humanities"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "central_argument",
      "category": "claim",
      "required": true,
      "question_text": "State your thesis in one sentence. Not the topic — the CLAIM you are making about the topic.",
      "accepts_free_text": true,
      "notes": "If the author can only give a topic, the piece isn't ready. Push for a provocative or at least non-obvious claim.",
      "mc_options": [
        {"id": "reinterpretation", "label": "A reinterpretation — X is usually read as A, but it's really B", "prefix": "X should be reinterpreted as "},
        {"id": "synthesis", "label": "A synthesis — A and B are usually treated separately; they are in fact connected by C", "prefix": "A and B are connected by "},
        {"id": "critique", "label": "A critique — the prevailing view of X is wrong because...", "prefix": "The prevailing view of X is wrong because "},
        {"id": "recovery", "label": "A recovery — X has been neglected and deserves renewed attention because...", "prefix": "X deserves renewed attention because "},
        {"id": "framework", "label": "A new framework — here is a better way to think about X", "prefix": "A better way to think about X is "},
        {"id": "historicize", "label": "A historicisation — X is not natural/universal; it has a history", "prefix": "X has a history: "},
        {"id": "other", "label": "Something else — I'll write the thesis sentence", "is_free_text": true}
      ]
    },
    {
      "id": "key_texts",
      "category": "evidence",
      "required": true,
      "question_text": "Name 3-5 primary texts, archives, or works you're engaging with directly. These are the material of your argument.",
      "accepts_free_text": true,
      "notes": "Without specific texts, the argument floats. Force commitment.",
      "mc_options": [
        {"id": "i_will_list", "label": "I'll list them (titles, authors, years)", "is_free_text": true}
      ]
    },
    {
      "id": "method_of_analysis",
      "category": "method",
      "required": true,
      "question_text": "How will you analyze those texts or that material? The method determines how the argument unfolds.",
      "accepts_free_text": true,
      "notes": "Close reading is slow and textual. Historical reads context. Comparative juxtaposes. Genealogical traces. Pick one or a combination.",
      "mc_options": [
        {"id": "close_reading", "label": "Close reading — textual detail as evidence"},
        {"id": "historical", "label": "Historical contextualisation — situating works in their moment"},
        {"id": "comparative", "label": "Comparative — juxtaposing two or more texts, periods, or figures"},
        {"id": "genealogical", "label": "Genealogical — tracing how a concept or practice emerged"},
        {"id": "theoretical_reading", "label": "Theoretical reading — applying a framework to texts"},
        {"id": "critique_immanent", "label": "Immanent critique — reading a work against its own assumptions"},
        {"id": "synthetic", "label": "Synthetic — assembling a pattern across many sources"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "argument_structure",
      "category": "structure",
      "required": true,
      "question_text": "How does the argument unfold? Most academic arguments follow one of these shapes.",
      "accepts_free_text": true,
      "notes": "Structure is a commitment. Linear buildup wants each section to raise the stakes; compare-contrast wants symmetry; genealogical wants chronological stages.",
      "mc_options": [
        {"id": "linear_buildup", "label": "Linear buildup — each section advances one step toward the thesis"},
        {"id": "thesis_objections", "label": "Thesis, then objections, then replies"},
        {"id": "compare_contrast", "label": "Compare-contrast — A and B across multiple dimensions"},
        {"id": "genealogical", "label": "Genealogical / chronological — stages of emergence"},
        {"id": "case_study_lens", "label": "Case study as lens — one case reveals a larger pattern"},
        {"id": "problem_solution", "label": "Problem statement → analysis → proposal"},
        {"id": "spiral", "label": "Spiral — same question asked at deeper levels repeatedly"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "stakes",
      "category": "significance",
      "required": true,
      "question_text": "What changes for a reader who accepts your argument? Why does this matter beyond the immediate topic?",
      "accepts_free_text": true,
      "notes": "The 'so what' question. If the author can't answer, the piece is technically competent but inconsequential.",
      "mc_options": [
        {"id": "rethink_canon", "label": "The canon / field should be rethought — X belongs differently"},
        {"id": "method_stakes", "label": "How we do this kind of work needs to change"},
        {"id": "historical_stakes", "label": "Our understanding of this period / figure / event is different"},
        {"id": "theoretical_stakes", "label": "A theoretical framework people use is flawed or incomplete"},
        {"id": "political_stakes", "label": "Political / ethical — the argument bears on contemporary debates"},
        {"id": "interdisciplinary_stakes", "label": "Bridges disciplines that should be talking and aren't"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "counterarguments",
      "category": "integrity",
      "required": true,
      "question_text": "What are the strongest objections to your argument? Which 1-2 will you need to answer explicitly?",
      "accepts_free_text": true,
      "notes": "Authors who can't state counterarguments haven't stress-tested their own work. Good academic writing takes objections seriously.",
      "mc_options": [
        {"id": "i_will_describe", "label": "I'll describe the main objections", "is_free_text": true}
      ]
    },
    {
      "id": "audience_register",
      "category": "positioning",
      "required": true,
      "question_text": "Who is the reader, and how technical should the register be?",
      "accepts_free_text": true,
      "notes": "Specialist venues reward jargon; interdisciplinary venues punish it. This shapes every paragraph.",
      "mc_options": [
        {"id": "specialists", "label": "Specialists in my subfield — I can use in-field vocabulary freely"},
        {"id": "discipline_broad", "label": "Broad audience within the discipline — assume discipline basics but explain subfield terms"},
        {"id": "interdisciplinary", "label": "Interdisciplinary academic readers — minimise jargon; explain terms"},
        {"id": "grad_students", "label": "Advanced grad students / entry-level specialists"},
        {"id": "public_intellectual", "label": "Educated public — clear prose, no footnote fortress"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "evidence_base",
      "category": "evidence",
      "required": false,
      "question_text": "What kinds of evidence are you drawing on, besides your primary texts?",
      "accepts_free_text": true,
      "notes": "A piece that uses only the primary text plus secondary literature feels thin. Archives, interviews, theoretical apparatus deepen the piece.",
      "mc_options": [
        {"id": "secondary_lit", "label": "Secondary literature — other scholars on these texts"},
        {"id": "archives", "label": "Archival materials — letters, drafts, unpublished sources"},
        {"id": "theory", "label": "Theoretical frameworks — Foucault, Butler, Bourdieu, etc."},
        {"id": "historical_context", "label": "Historical context — period documents, newspapers, political records"},
        {"id": "interviews_ethno", "label": "Interviews or fieldwork"},
        {"id": "quantitative", "label": "Light quantitative data — word frequencies, publication counts"},
        {"id": "multi", "label": "A combination — I'll describe"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "length_venue",
      "category": "positioning",
      "required": false,
      "question_text": "How long should this piece be, and where might it live?",
      "accepts_free_text": true,
      "notes": "Length is a design constraint — a 3K essay makes different choices than a 12K chapter.",
      "mc_options": [
        {"id": "short_essay", "label": "Short essay — 2-4K words"},
        {"id": "standard_article", "label": "Standard article — 6-10K words"},
        {"id": "long_chapter", "label": "Long chapter / review article — 10-15K words"},
        {"id": "monograph_section", "label": "Section of a monograph in progress"},
        {"id": "not_decided", "label": "Not decided — help me think"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "opening_move",
      "category": "structure",
      "required": false,
      "question_text": "How does the piece open? The first page does a lot of work in humanities writing.",
      "accepts_free_text": true,
      "notes": "A good academic opening establishes the problem, the stakes, and the author's voice in 2-3 paragraphs.",
      "mc_options": [
        {"id": "scene", "label": "With a scene, anecdote, or specific moment"},
        {"id": "puzzle", "label": "With a puzzle or apparent contradiction in the field"},
        {"id": "quote", "label": "With a quote or epigraph I'll unpack"},
        {"id": "claim", "label": "Directly with the claim — stakes up front"},
        {"id": "historiography", "label": "With a brief historiographical / field mapping"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    }
  ]$qb$::jsonb,
  -- completion_criteria
  $cc${
    "min_required_answers": 9,
    "non_skippable_question_ids": [
      "work_type","discipline","central_argument","key_texts","method_of_analysis",
      "argument_structure","stakes","counterarguments","audience_register"
    ]
  }$cc$::jsonb,
  -- output_schema
  $os${
    "approved": "boolean",
    "sections": [
      {
        "question_id": "string",
        "question_text": "string",
        "answer_text": "string",
        "answer_type": "mc|free|mc_plus_free",
        "mc_choice_id": "string?",
        "voice_notes": "string[]?",
        "skipped": "boolean?"
      }
    ],
    "document_type": "academic",
    "sections_count": "int",
    "interview_version": "int"
  }$os$::jsonb,
  'Seeded 2026-04-23 per Founder directive: every interview must be specific. Academic != proposal. Argument-driven humanities/humanistic-social-science register. 12 Q, min 9, 9 non-skippable.'
);

-- ---------------------------------------------------------------------------
-- poetry : poetry collection, chapbook, book-length poem, or sequence.
-- Pure craft interview. No market framing. No chapter counts. No plot.
-- Orients around obsession, image, voice, form, lineage, sound.
-- ---------------------------------------------------------------------------
INSERT INTO public.interview_prompts
  (document_type, version, is_active,
   system_prompt, opening_prompt_template,
   question_bank, completion_criteria, output_schema, notes)
VALUES (
  'poetry', 1, true,
  -- system_prompt
  $sp$You are the Interviewer conducting an intake for a poetry project — a chapbook, full collection, book-length poem, or sequence. This is different from every other document type: there is no topic in the business sense, no audience in the marketing sense, no chapter count, no argumentative structure.

What there is: an obsession, a set of recurring images, a voice, a formal approach, and a lineage. Your job is to surface all of these in plain, respectful language. Poets often resist being asked "what is it about" — their work doesn't reduce to aboutness. Instead ask what the project CIRCLES, what IMAGES recur, what the work SOUNDS like aloud, what POETS shaped it, and what specific poems already exist that represent the project.

Be a literary editor in a close-reading session: thoughtful, patient, craft-focused, interested in the poet's formal commitments and sonic instincts. Do not ask about reader transformation or bestseller positioning. If a question feels reductive to the poet, reframe it gently.

Walk question_bank in order. Accept mc_choice_id, free text, or both. For anchor_poems especially, push for specific titles or first lines — generalities are useless to the outline agent, which will organize the collection.

Emit {approved:true, sections:[...], document_type, sections_count, interview_version} when (a) non-skipped sections >= min_required_answers AND (b) every non_skippable_question_id has a non-skipped answer.$sp$,
  -- opening_prompt_template
  $op$You're building a poetry project around: **{{validation_data.chosenTopic}}**.

{{validation_data.score.summary}}

Poetry is different from every other document we build — the questions here are about craft and obsession, not markets or arguments. I'll ask what the work CIRCLES, what IMAGES keep returning, what it sounds like read aloud, which poets shaped you, and what specific poems you've already written that anchor the project. Take your time on these. The outline agent will organize the collection based on what you tell me.$op$,
  -- question_bank
  $qb$[
    {
      "id": "work_shape",
      "category": "context",
      "required": true,
      "question_text": "What's the shape of the project?",
      "accepts_free_text": true,
      "notes": "Fundamentally different projects. A chapbook wants 18-30 poems tightly braided. A book-length poem wants a single sustained voice. Know this first.",
      "mc_options": [
        {"id": "single_long", "label": "A single long poem or sequence — one sustained work"},
        {"id": "chapbook", "label": "A chapbook — 18-30 pages, tightly thematic"},
        {"id": "full_collection", "label": "A full collection — 48-80 pages, multi-section"},
        {"id": "book_length_poem", "label": "A book-length poem — unified work broken into numbered / titled sections"},
        {"id": "sequence", "label": "A sequence / serial poem — ongoing, may extend beyond this book"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "controlling_obsession",
      "category": "content",
      "required": true,
      "question_text": "What does the whole project circle? Not a topic — a question, a wound, a longing, an argument, a ghost.",
      "accepts_free_text": true,
      "notes": "Aboutness is the wrong frame for poetry; obsession is the right one. Every real collection has one.",
      "mc_options": [
        {"id": "grief", "label": "A loss or grief I'm working through"},
        {"id": "place", "label": "A specific place that haunts the work"},
        {"id": "relation", "label": "A relationship — family, beloved, absent figure"},
        {"id": "body", "label": "The body — illness, gender, sexuality, hunger, labor"},
        {"id": "politics", "label": "A political reality I'm responding to"},
        {"id": "cosmology", "label": "A cosmological or metaphysical question"},
        {"id": "language_itself", "label": "Language itself — what poems can and cannot do"},
        {"id": "inheritance", "label": "An inheritance — cultural, linguistic, ancestral"},
        {"id": "other", "label": "Something else — I'll describe", "is_free_text": true}
      ]
    },
    {
      "id": "core_images",
      "category": "content",
      "required": true,
      "question_text": "What images keep returning across the poems? Name 3-5 specific ones.",
      "accepts_free_text": true,
      "notes": "Images are the architecture of a collection. Specific beats abstract: 'my grandmother's hands' beats 'family.'",
      "mc_options": [
        {"id": "i_will_list", "label": "I'll name specific recurring images", "is_free_text": true}
      ]
    },
    {
      "id": "voice",
      "category": "craft",
      "required": true,
      "question_text": "Whose voice speaks these poems?",
      "accepts_free_text": true,
      "notes": "Voice choice is a craft commitment. Confessional I, persona, observational speaker, collective we — all produce very different books.",
      "mc_options": [
        {"id": "confessional_i", "label": "First-person — the speaker is essentially me"},
        {"id": "persona", "label": "Persona — a character who is NOT me speaks"},
        {"id": "observational", "label": "Observational — a watching speaker who rarely enters the frame"},
        {"id": "collective_we", "label": "Collective — 'we' of a community, generation, or tradition"},
        {"id": "second_person", "label": "Second-person — 'you' addressing the reader or another"},
        {"id": "third_person", "label": "Third-person — scenes without a first-person speaker"},
        {"id": "hybrid", "label": "Hybrid — the voice shifts deliberately across poems"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "formal_approach",
      "category": "craft",
      "required": true,
      "question_text": "What formal commitments shape the work? Pick one or more.",
      "accepts_free_text": true,
      "notes": "Form is content in poetry. Free verse sounds nothing like a sestina; prose poetry is a third thing entirely.",
      "mc_options": [
        {"id": "free_verse_short", "label": "Free verse — short to mid-length lyric"},
        {"id": "free_verse_long", "label": "Free verse — long-lined, expansive"},
        {"id": "received_forms", "label": "Received forms — sonnets, sestinas, villanelles, ghazals"},
        {"id": "prose_poetry", "label": "Prose poetry — paragraph-shaped"},
        {"id": "documentary", "label": "Documentary / found — erasure, archive, testimony"},
        {"id": "experimental", "label": "Experimental — typographic, visual, conceptual"},
        {"id": "serial", "label": "Serial — numbered or sectioned movements"},
        {"id": "hybrid_forms", "label": "Hybrid — deliberate shifts in form across the book"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "sonic_signature",
      "category": "craft",
      "required": true,
      "question_text": "Read your favorite line from the project out loud in your head. What does the work SOUND like? Dense, spare, percussive, sibilant, plain, ornate?",
      "accepts_free_text": true,
      "notes": "Sound is where amateur poetry fails. The poet should be able to articulate what they listen for.",
      "mc_options": [
        {"id": "i_will_describe", "label": "I'll describe the sound", "is_free_text": true}
      ]
    },
    {
      "id": "lineage",
      "category": "craft",
      "required": true,
      "question_text": "Name 2-3 poets whose work made this project possible. Not influences in general — poets you're in direct conversation with.",
      "accepts_free_text": true,
      "notes": "Poets with clear lineage write stronger books. If the author can't name them, the work is probably generic.",
      "mc_options": [
        {"id": "i_will_name", "label": "I'll name specific poets", "is_free_text": true}
      ]
    },
    {
      "id": "anchor_poems",
      "category": "content",
      "required": true,
      "question_text": "Name 2-3 specific poems (title or first line) you've already written that ARE the project. The pieces everything else orbits.",
      "accepts_free_text": true,
      "notes": "Every real collection has anchor poems — pieces the poet knows are load-bearing. If none exist, the project isn't ready; steer author to draft one first.",
      "mc_options": [
        {"id": "i_will_name", "label": "I'll give titles or first lines", "is_free_text": true}
      ]
    },
    {
      "id": "tonal_range",
      "category": "craft",
      "required": false,
      "question_text": "What tones does the project hold? Pick all that fit.",
      "accepts_free_text": true,
      "notes": "Single-tone collections tire. The best collections hold several tones in tension.",
      "mc_options": [
        {"id": "elegiac", "label": "Elegiac / mourning"},
        {"id": "ecstatic", "label": "Ecstatic / celebratory"},
        {"id": "tender", "label": "Tender / intimate"},
        {"id": "witty_ironic", "label": "Witty / ironic"},
        {"id": "meditative", "label": "Meditative / contemplative"},
        {"id": "political_urgent", "label": "Political / urgent"},
        {"id": "grief_stricken", "label": "Grief-stricken"},
        {"id": "comedic", "label": "Comedic / absurd"},
        {"id": "rage", "label": "Rage / protest"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "structural_arc",
      "category": "structure",
      "required": true,
      "question_text": "How is the book ordered? The arrangement is part of the meaning.",
      "accepts_free_text": true,
      "notes": "A collection is not a folder. Arrangement makes meaning through adjacency.",
      "mc_options": [
        {"id": "thematic_groups", "label": "Thematic sections — poems gathered by subject"},
        {"id": "chronological", "label": "Chronological — narrative arc through time"},
        {"id": "formal_arc", "label": "Formal arc — forms shift across the book"},
        {"id": "conversation", "label": "Conversation — poems answer or rebut each other"},
        {"id": "journey", "label": "Journey — speaker moves from A to B"},
        {"id": "no_arc", "label": "Deliberately no arc — each poem stands alone"},
        {"id": "numbered", "label": "Numbered sections — I, II, III"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    },
    {
      "id": "reader_experience",
      "category": "reader",
      "required": true,
      "question_text": "What happens in a reader between the first poem and the last? The emotional or perceptual shift?",
      "accepts_free_text": true,
      "notes": "A collection that doesn't change the reader is a folder. This is the arc the ordering serves.",
      "mc_options": [
        {"id": "i_will_describe", "label": "I'll describe the shift I want", "is_free_text": true}
      ]
    },
    {
      "id": "collection_length",
      "category": "scope",
      "required": false,
      "question_text": "How many poems, roughly?",
      "accepts_free_text": true,
      "notes": "Length determines how much breathing room between anchor poems.",
      "mc_options": [
        {"id": "single", "label": "A single poem or very short sequence (1-5 poems)"},
        {"id": "chapbook_short", "label": "~12-20 poems — chapbook size"},
        {"id": "full_collection", "label": "~40-60 poems — full collection"},
        {"id": "book_long", "label": "60+ poems — a long book"},
        {"id": "undecided", "label": "Undecided — let the work tell me"},
        {"id": "other", "label": "Something else", "is_free_text": true}
      ]
    }
  ]$qb$::jsonb,
  -- completion_criteria
  $cc${
    "min_required_answers": 9,
    "non_skippable_question_ids": [
      "work_shape","controlling_obsession","core_images","voice","formal_approach",
      "sonic_signature","lineage","anchor_poems","structural_arc","reader_experience"
    ]
  }$cc$::jsonb,
  -- output_schema
  $os${
    "approved": "boolean",
    "sections": [
      {
        "question_id": "string",
        "question_text": "string",
        "answer_text": "string",
        "answer_type": "mc|free|mc_plus_free",
        "mc_choice_id": "string?",
        "voice_notes": "string[]?",
        "skipped": "boolean?"
      }
    ],
    "document_type": "poetry",
    "sections_count": "int",
    "interview_version": "int"
  }$os$::jsonb,
  'Seeded 2026-04-23 per Founder directive: every interview must be specific. Poetry != fiction (no plot, no chapter counts, no market framing). Craft-first: obsession, image, voice, form, lineage, sound. 12 Q, min 9, 10 non-skippable.'
);

-- ---------------------------------------------------------------------------
-- Update resolve_interview_prompt() to route the three new types direct
-- and remove them from the fallback table. Keep all other fallbacks intact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_interview_prompt(p_content_type text)
RETURNS TABLE(
  resolved_document_type text,
  resolved_version integer,
  system_prompt text,
  opening_prompt_template text,
  question_bank jsonb,
  completion_criteria jsonb,
  output_schema jsonb,
  is_fallback boolean
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_target text;
  v_is_fallback boolean := false;
BEGIN
  -- Direct match if one of the seeded types. Expanded 2026-04-23 to include
  -- paper, academic, poetry (previously fell back incorrectly).
  IF p_content_type IN (
    'non-fiction','fiction','memoir','business_plan','proposal',
    'thesis','dissertation','paper','academic','poetry'
  ) THEN
    v_target := p_content_type;
  ELSE
    -- Map unseeded types to nearest seeded type. NOTE: these are acknowledged
    -- approximations and CEO-035 tracks seeding the rest. Do not add any
    -- content_type that has live projects to this fallback table — seed
    -- it direct instead (Founder directive).
    v_target := CASE
      -- Narrative creative → fiction (short_story, screenplay, children)
      -- poetry removed — now has its own row
      WHEN p_content_type IN ('short_story','screenplay','children') THEN 'fiction'

      -- Life writing → memoir
      WHEN p_content_type IN ('biography') THEN 'memoir'

      -- Most non-narrative longform → non-fiction
      WHEN p_content_type IN ('self-help','cookbook','travel','book','white_paper','report',
                              'educational','technical','technical_doc','api_docs','user_manual',
                              'specification','essay_collection','contract','nda','terms_of_service',
                              'privacy_policy','policy_document','policy','legal_brief','other')
           THEN 'non-fiction'

      -- Business-adjacent → business_plan
      WHEN p_content_type IN ('business','pitch_deck','financial_model') THEN 'business_plan'

      -- Research-adjacent → paper (now seeded). research_paper maps to paper.
      WHEN p_content_type IN ('research_paper') THEN 'paper'

      -- Ultimate fallback
      ELSE 'non-fiction'
    END;
    v_is_fallback := true;
  END IF;

  RETURN QUERY
  SELECT
    p.document_type,
    p.version,
    p.system_prompt,
    p.opening_prompt_template,
    p.question_bank,
    p.completion_criteria,
    p.output_schema,
    v_is_fallback
  FROM public.interview_prompts p
  WHERE p.document_type = v_target
    AND p.is_active = true
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.resolve_interview_prompt(text) IS
  'Returns the active interview prompt for a content_type. Direct-maps the 10 seeded types (non-fiction, fiction, memoir, business_plan, proposal, thesis, dissertation, paper, academic, poetry); others fall through to a nearest-neighbour table with is_fallback=true. Per Founder directive 2026-04-23, no content_type with live projects should be on the fallback table — seed it direct.';

COMMIT;
