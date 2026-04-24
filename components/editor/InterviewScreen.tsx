'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  InterviewQuestion, 
  FollowUpQuestion, 
  FOLLOW_UP_QUESTIONS,
  CITATION_STYLE_QUESTION,
  extractCitationStyleId
} from '@/types/agent-workflow';
import { getTemplate } from '@/lib/ai/document-templates';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
import { 
  Mic, 
  Save, 
  SkipForward, 
  Send,
  CheckCircle2,
  Upload,
  ArrowRight,
  Bot,
  User
} from 'lucide-react';

// Stable English sentinel emitted by the interview-system AI prompt in
// lib/ai/agents/interview-system.ts and lib/ai/agents/index.ts. The AI always
// emits this exact English string as the last option on multiple-choice
// questions, so the comparison in handleOptionSelect must match it literally.
// The DISPLAYED label is translated via t('interview.somethingElse', locale).
const SOMETHING_ELSE_SENTINEL = 'Something else...';

interface InterviewScreenProps {
  questions: InterviewQuestion[];
  chosenIdea?: string;            // The validated idea from Validate stage
  ideaPositioning?: string;       // Optional positioning hook (if from stronger proposal)
  projectId?: string;             // For dynamic follow-up generation
  contentType?: string;           // Drives citation-style picker visibility in follow-up
  onAnswer: (questionId: string, answer: string) => void;
  onSaveAndExit: () => void;
  onStopAndNext: (followUpAnswers: Record<string, string>) => void;
  onUploadFile?: (file: File) => void;
  /**
   * Called when a new dynamic follow-up question should be spliced into the
   * remaining question queue. The parent owns the questions array and must
   * mutate it so this screen re-renders with the new question in place.
   */
  onInjectDynamicFollowup?: (question: InterviewQuestion, insertAfterIndex: number) => void;
  locale?: Locale;
}

type Phase = 'interview' | 'followup';

export function InterviewScreen({
  questions,
  chosenIdea,
  ideaPositioning,
  projectId,
  contentType,
  onAnswer,
  onSaveAndExit,
  onStopAndNext,
  onUploadFile,
  onInjectDynamicFollowup,
  locale = 'en',
}: InterviewScreenProps) {
  const [phase, setPhase] = useState<Phase>('interview');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [customAnswer, setCustomAnswer] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [dynamicFollowupRationale, setDynamicFollowupRationale] = useState<Record<number, string>>({});
  // For multi-select questions: the set of labels the user has ticked so far.
  // Cleared when the question changes. Works alongside the 'Something else...'
  // flow — users can tick checkboxes AND add a free-text entry on the same Q.
  const [multiSelections, setMultiSelections] = useState<string[]>([]);

  // Reset per-question transient state when currentIndex changes
  useEffect(() => {
    setMultiSelections([]);
    setShowCustomInput(false);
    setCustomAnswer('');
  }, [currentIndex]);

  // Build the follow-up question list. For document types that require citations
  // (research papers, theses, white papers, business plans), append the
  // citation-style picker as an additional follow-up card. Its answer is
  // mapped to a stable id ("apa" / "vancouver" / etc.) that the outline,
  // research, and writing agents all read from follow_up_data.citationStyle.
  const template = contentType ? getTemplate(contentType) : null;
  const requiresCitations = template?.requiresCitations === true;
  const followUpQuestions: FollowUpQuestion[] = requiresCitations
    ? [...FOLLOW_UP_QUESTIONS, CITATION_STYLE_QUESTION]
    : FOLLOW_UP_QUESTIONS;

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const answeredCount = questions.filter(q => q.answer).length;

  /**
   * Ask Claude (Haiku) for a contextual follow-up based on prior answers.
   * Runs in the background after the user answers — doesn't block advancing.
   */
  const maybeGenerateFollowup = async (questionIndex: number, answerJustGiven: string) => {
    if (!projectId || !chosenIdea || !onInjectDynamicFollowup) return;

    // Build the answers seen so far (including the one just given)
    const answersSoFar = questions
      .slice(0, questionIndex + 1)
      .map((q, i) => ({
        question: q.question,
        answer: i === questionIndex ? answerJustGiven : q.answer || '',
      }))
      .filter((a) => a.answer.trim());

    if (answersSoFar.length < 2) return;

    try {
      const resp = await fetch('/api/ai/interview-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          chosenIdea,
          answers: answersSoFar,
          contentType,
        }),
      });
      const data = await resp.json();
      if (!data?.followup?.question) return;

      const f = data.followup as { question: string; rationale: string; type: string };
      const injected: InterviewQuestion = {
        id: `dyn-${Date.now()}`,
        question: f.question,
        type: 'open',
      };

      // Remember the rationale so it can be shown under the question.
      setDynamicFollowupRationale((prev) => ({
        ...prev,
        [questionIndex + 1]: f.rationale,
      }));

      onInjectDynamicFollowup(injected, questionIndex);
    } catch {
      // Non-fatal — the static interview continues without follow-ups.
    }
  };
  
  const handleOptionSelect = (option: string) => {
    // Multi-select path: toggle membership and let the user hit Continue when ready
    if (currentQuestion?.multi) {
      if (option === SOMETHING_ELSE_SENTINEL) {
        setShowCustomInput(true);
        return;
      }
      setMultiSelections((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
      );
      return;
    }

    // Single-select (legacy) path
    if (option === SOMETHING_ELSE_SENTINEL) {
      setShowCustomInput(true);
      return;
    }

    onAnswer(currentQuestion.id, option);
    maybeGenerateFollowup(currentIndex, option);
    moveToNext();
  };

  /**
   * Commit a multi-select answer. Joins all ticked boxes + any free-text
   * 'Something else...' entry into a single comma-separated string so the
   * rest of the pipeline (which treats answers as strings) keeps working.
   */
  const handleMultiSubmit = () => {
    const pieces = [...multiSelections];
    const custom = customAnswer.trim();
    if (custom) pieces.push(custom);
    if (pieces.length === 0) return;
    const joined = pieces.join(', ');
    onAnswer(currentQuestion.id, joined);
    maybeGenerateFollowup(currentIndex, joined);
    moveToNext();
  };

  const handleCustomSubmit = () => {
    if (!customAnswer.trim()) return;

    // If this is a multi-select question with checkboxes already ticked,
    // prefer the combined multi-submit (custom text becomes an extra entry).
    if (currentQuestion?.multi && multiSelections.length > 0) {
      handleMultiSubmit();
      return;
    }

    const answer = customAnswer;
    onAnswer(currentQuestion.id, answer);
    setCustomAnswer('');
    setShowCustomInput(false);
    maybeGenerateFollowup(currentIndex, answer);
    moveToNext();
  };

  const handleOpenAnswer = () => {
    if (!customAnswer.trim()) return;

    const answer = customAnswer;
    onAnswer(currentQuestion.id, answer);
    setCustomAnswer('');
    maybeGenerateFollowup(currentIndex, answer);
    moveToNext();
  };
  
  const moveToNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };
  
  const handleStopInterview = () => {
    setPhase('followup');
  };
  
  const handleFollowUpAnswer = (questionId: string, answer: string) => {
    setFollowUpAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };
  
  const handleContinueToResearch = () => {
    // Normalize the citation style answer to a stable short id so the backend
    // reads follow_up_data.citationStyle as "apa" / "vancouver" / etc.
    const normalized = { ...followUpAnswers };
    if (normalized.citationStyle) {
      const id = extractCitationStyleId(normalized.citationStyle);
      if (id) normalized.citationStyle = id;
    }
    onStopAndNext(normalized);
  };
  
  const allFollowUpAnswered = followUpQuestions.every(
    q => followUpAnswers[q.id]
  );

  // Interview Phase
  if (phase === 'interview') {
    // When we have a chosen idea, the very first question should reference it.
    // We override the rendered question text for index 0 only if chosenIdea is present.
    const isFirstQuestion = currentIndex === 0;
    const firstQuestionIntro = chosenIdea && isFirstQuestion
      ? (ideaPositioning
          ? t('interview.firstQuestionIntroWithPositioning', locale)
              .replace('{idea}', chosenIdea)
              .replace('{positioning}', ideaPositioning)
              .replace('{question}', currentQuestion?.question || '')
          : t('interview.firstQuestionIntro', locale)
              .replace('{idea}', chosenIdea)
              .replace('{question}', currentQuestion?.question || ''))
      : currentQuestion?.question;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 pb-10 max-w-2xl mx-auto w-full">
        {/* Chosen idea banner — visible throughout the interview as a north star */}
        {chosenIdea && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
              {t('interview.writingAbout', locale)}
            </div>
            <p className="text-sm font-medium">{chosenIdea}</p>
            {ideaPositioning && (
              <p className="text-xs text-muted-foreground italic mt-1">{ideaPositioning}</p>
            )}
          </div>
        )}

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Mic className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">{t('interview.title', locale)}</h1>
          </div>

          {/* Progress Bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {currentIndex + 1}/{questions.length} {t('interview.questionsCounter', locale)}
            </span>
          </div>
        </div>

        {/* Question Card */}
        <div className="flex-1 overflow-y-auto">
          <div className="rounded-xl border bg-card p-6 mb-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg">{firstQuestionIntro}</p>
                {currentQuestion?.helpText && !isFirstQuestion && (
                  <p className="text-sm text-muted-foreground mt-1">{currentQuestion.helpText}</p>
                )}
                {dynamicFollowupRationale[currentIndex] && !isFirstQuestion && (
                  <p className="text-xs text-muted-foreground/80 italic mt-2">
                    {dynamicFollowupRationale[currentIndex]}
                  </p>
                )}
              </div>
            </div>

            {/* Multiple Choice Options (single-select OR multi-select) */}
            {currentQuestion?.type === 'multiple_choice' && !showCustomInput && (
              <div className="space-y-2 ml-11">
                {currentQuestion.multi && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('interview.pickOneOrMore', locale)}
                  </p>
                )}
                {currentQuestion.options?.map((option, idx) => {
                  const isSelected = currentQuestion.multi
                    ? multiSelections.includes(option)
                    : currentQuestion.answer === option;
                  // Translate the sentinel for display only — the underlying
                  // value stays English so logic comparisons still fire.
                  const displayOption = option === SOMETHING_ELSE_SENTINEL
                    ? t('interview.somethingElse', locale)
                    : option;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleOptionSelect(option)}
                      className={cn(
                        'w-full text-left p-3 rounded-lg border transition-colors',
                        'hover:bg-primary/10 hover:border-primary',
                        isSelected && 'bg-primary/10 border-primary',
                      )}
                    >
                      <span className="text-muted-foreground mr-2">
                        {currentQuestion.multi ? (isSelected ? '☑' : '☐') : '○'}
                      </span>
                      {displayOption}
                    </button>
                  );
                })}
                {currentQuestion.multi && (
                  <Button
                    onClick={handleMultiSubmit}
                    disabled={multiSelections.length === 0}
                    className="w-full mt-2"
                  >
                    {t('interview.continue', locale)} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            
            {/* Custom Input for "Something else..." */}
            {showCustomInput && (
              <div className="ml-11 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('interview.tellMeMore', locale)}
                </p>
                <Textarea
                  value={customAnswer}
                  onChange={(e) => setCustomAnswer(e.target.value)}
                  placeholder={t('interview.answerPlaceholder', locale)}
                  className="min-h-[100px]"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCustomInput(false);
                      setCustomAnswer('');
                    }}
                  >
                    {t('interview.backToOptions', locale)}
                  </Button>
                  <Button onClick={handleCustomSubmit} disabled={!customAnswer.trim()}>
                    <Send className="mr-2 h-4 w-4" />
                    {t('interview.submit', locale)}
                  </Button>
                </div>
              </div>
            )}
            
            {/* Open-ended Question */}
            {currentQuestion?.type === 'open' && (
              <div className="ml-11 space-y-3">
                <Textarea
                  value={customAnswer}
                  onChange={(e) => setCustomAnswer(e.target.value)}
                  placeholder={t('interview.openPlaceholder', locale)}
                  className="min-h-[120px]"
                />
                <Button onClick={handleOpenAnswer} disabled={!customAnswer.trim()}>
                  <Send className="mr-2 h-4 w-4" />
                  {t('interview.continue', locale)}
                </Button>
              </div>
            )}
          </div>
          
          {/* File Upload */}
          <div className="rounded-lg border border-dashed p-4 text-center mb-4">
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-2">
              {t('interview.uploadPrompt', locale)}
            </p>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                {t('interview.chooseFile', locale)}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.md,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && onUploadFile) {
                      onUploadFile(file);
                    }
                  }}
                />
              </label>
            </Button>
          </div>
        </div>
        
        {/* Bottom Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onSaveAndExit} className="flex-1">
            <Save className="mr-2 h-4 w-4" />
            {t('interview.saveAndExit', locale)}
          </Button>
          <Button variant="default" onClick={handleStopInterview} className="flex-1">
            <SkipForward className="mr-2 h-4 w-4" />
            {t('interview.stopAndNext', locale)}
          </Button>
        </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Follow-up Phase
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 pb-10 max-w-3xl mx-auto w-full">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold mb-2">{t('interview.followupTitle', locale)}</h1>
        <p className="text-muted-foreground">
          {t('interview.followupSubtitle', locale)}
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {followUpQuestions.map((question) => (
          <div 
            key={question.id}
            className="rounded-xl border bg-card p-4"
          >
            <h3 className="font-semibold mb-3">{question.title}</h3>
            <p className="text-sm text-muted-foreground mb-3">{question.question}</p>
            
            <div className="space-y-2">
              {question.options.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => handleFollowUpAnswer(question.id, option)}
                  className={cn(
                    'w-full text-left p-2 rounded-lg border text-sm transition-colors',
                    'hover:bg-primary/10 hover:border-primary',
                    followUpAnswers[question.id] === option && 'bg-primary/10 border-primary'
                  )}
                >
                  <span className="text-muted-foreground mr-2">○</span>
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex justify-center">
        <Button 
          onClick={handleContinueToResearch}
          disabled={!allFollowUpAnswered}
          size="lg"
        >
          {t('interview.continueToResearch', locale)}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      
      {!allFollowUpAnswered && (
        <p className="text-center text-sm text-muted-foreground mt-3">
          {t('interview.pleaseAnswerAll', locale)}
        </p>
      )}
        </div>
      </div>
    </div>
  );
}
