'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  InterviewQuestion, 
  FollowUpQuestion, 
  FOLLOW_UP_QUESTIONS 
} from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
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

interface InterviewScreenProps {
  questions: InterviewQuestion[];
  chosenIdea?: string;            // The validated idea from Validate stage
  ideaPositioning?: string;       // Optional positioning hook (if from stronger proposal)
  onAnswer: (questionId: string, answer: string) => void;
  onSaveAndExit: () => void;
  onStopAndNext: (followUpAnswers: Record<string, string>) => void;
  onUploadFile?: (file: File) => void;
}

type Phase = 'interview' | 'followup';

export function InterviewScreen({
  questions,
  chosenIdea,
  ideaPositioning,
  onAnswer,
  onSaveAndExit,
  onStopAndNext,
  onUploadFile
}: InterviewScreenProps) {
  const [phase, setPhase] = useState<Phase>('interview');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [customAnswer, setCustomAnswer] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  
  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const answeredCount = questions.filter(q => q.answer).length;
  
  const handleOptionSelect = (option: string) => {
    if (option === 'Something else...') {
      setShowCustomInput(true);
      return;
    }
    
    onAnswer(currentQuestion.id, option);
    moveToNext();
  };
  
  const handleCustomSubmit = () => {
    if (!customAnswer.trim()) return;
    
    onAnswer(currentQuestion.id, customAnswer);
    setCustomAnswer('');
    setShowCustomInput(false);
    moveToNext();
  };
  
  const handleOpenAnswer = () => {
    if (!customAnswer.trim()) return;
    
    onAnswer(currentQuestion.id, customAnswer);
    setCustomAnswer('');
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
    onStopAndNext(followUpAnswers);
  };
  
  const allFollowUpAnswered = FOLLOW_UP_QUESTIONS.every(
    q => followUpAnswers[q.id]
  );

  // Interview Phase
  if (phase === 'interview') {
    // When we have a chosen idea, the very first question should reference it.
    // We override the rendered question text for index 0 only if chosenIdea is present.
    const isFirstQuestion = currentIndex === 0;
    const firstQuestionIntro = chosenIdea && isFirstQuestion
      ? `Great — we're moving forward with: "${chosenIdea}". ${ideaPositioning ? `That's "${ideaPositioning}". ` : ''}To make sure I capture your vision accurately, let me start with this: ${currentQuestion?.question}`
      : currentQuestion?.question;

    return (
      <div className="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
        {/* Chosen idea banner — visible throughout the interview as a north star */}
        {chosenIdea && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
              Writing About
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
            <h1 className="text-xl font-bold">Interview: Let's dive deeper</h1>
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
              {currentIndex + 1}/{questions.length} questions
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
              <p className="text-lg">{firstQuestionIntro}</p>
            </div>
            
            {/* Multiple Choice Options */}
            {currentQuestion?.type === 'multiple_choice' && !showCustomInput && (
              <div className="space-y-2 ml-11">
                {currentQuestion.options?.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOptionSelect(option)}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      'hover:bg-primary/10 hover:border-primary',
                      currentQuestion.answer === option && 'bg-primary/10 border-primary'
                    )}
                  >
                    <span className="text-muted-foreground mr-2">○</span>
                    {option}
                  </button>
                ))}
              </div>
            )}
            
            {/* Custom Input for "Something else..." */}
            {showCustomInput && (
              <div className="ml-11 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tell me more about that...
                </p>
                <Textarea
                  value={customAnswer}
                  onChange={(e) => setCustomAnswer(e.target.value)}
                  placeholder="Type your answer here..."
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
                    Back to options
                  </Button>
                  <Button onClick={handleCustomSubmit} disabled={!customAnswer.trim()}>
                    <Send className="mr-2 h-4 w-4" />
                    Submit
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
                  placeholder="Take your time with this one - the more detail you share, the better I can help shape your book."
                  className="min-h-[120px]"
                />
                <Button onClick={handleOpenAnswer} disabled={!customAnswer.trim()}>
                  <Send className="mr-2 h-4 w-4" />
                  Continue
                </Button>
              </div>
            )}
          </div>
          
          {/* File Upload */}
          <div className="rounded-lg border border-dashed p-4 text-center mb-4">
            <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-2">
              Have existing content? Upload drafts, images, or research.
            </p>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                Choose File
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
            Save and Exit
          </Button>
          <Button variant="default" onClick={handleStopInterview} className="flex-1">
            <SkipForward className="mr-2 h-4 w-4" />
            Stop Interview & Next
          </Button>
        </div>
      </div>
    );
  }
  
  // Follow-up Phase
  return (
    <div className="flex-1 flex flex-col p-6 max-w-3xl mx-auto w-full">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold mb-2">📋 Quick Follow-Up Questions</h1>
        <p className="text-muted-foreground">
          Help us finalize your document settings
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {FOLLOW_UP_QUESTIONS.map((question) => (
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
          Continue to Research
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      
      {!allFollowUpAnswered && (
        <p className="text-center text-sm text-muted-foreground mt-3">
          Please answer all questions to continue
        </p>
      )}
    </div>
  );
}
