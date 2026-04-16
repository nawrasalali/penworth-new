'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ValidationScore } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { 
  Sparkles, 
  ArrowRight, 
  Lightbulb, 
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface ValidateScreenProps {
  onValidate: (topic: string) => Promise<ValidationScore>;
  onProceed: (topic: string, score: ValidationScore) => void;
  initialTopic?: string;
}

type Phase = 'input' | 'validating' | 'results' | 'alternative' | 'revalidating';

export function ValidateScreen({ onValidate, onProceed, initialTopic = '' }: ValidateScreenProps) {
  const [phase, setPhase] = useState<Phase>('input');
  const [topic, setTopic] = useState(initialTopic);
  const [score, setScore] = useState<ValidationScore | null>(null);
  const [alternativeTopic, setAlternativeTopic] = useState<string | null>(null);
  const [alternativeScore, setAlternativeScore] = useState<ValidationScore | null>(null);
  
  const handleValidate = async () => {
    if (!topic.trim()) return;
    
    setPhase('validating');
    try {
      const result = await onValidate(topic);
      setScore(result);
      setPhase('results');
    } catch (error) {
      console.error('Validation failed:', error);
      setPhase('input');
    }
  };
  
  const handleRequestAlternative = async () => {
    if (!score?.alternatives?.[0]) return;
    
    const alt = score.alternatives[0];
    setAlternativeTopic(alt.title);
    setPhase('revalidating');
    
    try {
      const result = await onValidate(alt.title);
      setAlternativeScore(result);
      setPhase('alternative');
    } catch (error) {
      console.error('Alternative validation failed:', error);
      setPhase('results');
    }
  };
  
  const handleProceed = (chosenTopic: string, chosenScore: ValidationScore) => {
    onProceed(chosenTopic, chosenScore);
  };
  
  const getVerdictColor = (verdict: ValidationScore['verdict']) => {
    switch (verdict) {
      case 'STRONG': return 'text-green-500';
      case 'PROMISING': return 'text-amber-500';
      case 'RISKY': return 'text-orange-500';
      case 'RECONSIDER': return 'text-red-500';
    }
  };
  
  const getScoreColor = (total: number) => {
    if (total >= 70) return 'bg-green-500';
    if (total >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  // Phase: Input
  if (phase === 'input') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Validate Your Book Idea</h1>
          <p className="text-muted-foreground">
            Tell us about your book idea and we'll analyze its market potential, 
            help you refine it, and ensure you're set up for success.
          </p>
        </div>
        
        <div className="w-full space-y-4">
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Describe your book idea in detail. What's it about? Who is it for? What makes it unique?"
            className="min-h-[150px] resize-none"
          />
          
          <Button 
            onClick={handleValidate} 
            className="w-full"
            disabled={!topic.trim()}
          >
            Validate My Idea
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
  
  // Phase: Validating
  if (phase === 'validating' || phase === 'revalidating') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {phase === 'revalidating' ? 'Validating Alternative...' : 'Analyzing Your Idea...'}
        </h2>
        <p className="text-muted-foreground text-center max-w-md">
          We're evaluating market demand, target audience clarity, unique value proposition, 
          and commercial viability.
        </p>
      </div>
    );
  }
  
  // Phase: Results
  if (phase === 'results' && score) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-bold mb-6 text-center">📊 Validation Results</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-w-3xl mx-auto">
          {/* Score Card */}
          <div className={cn(
            'rounded-xl p-6 text-center',
            getScoreColor(score.total),
            'text-white'
          )}>
            <div className="text-5xl font-bold mb-1">{score.total}</div>
            <div className="text-lg opacity-90">/100</div>
            <div className="mt-2 text-xl font-semibold">{score.verdict}</div>
          </div>
          
          {/* Summary Card */}
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              Summary
            </h3>
            <p className="text-sm text-muted-foreground">{score.summary}</p>
          </div>
        </div>
        
        {/* Breakdown */}
        <div className="max-w-3xl mx-auto mb-6">
          <h3 className="font-semibold mb-3">Score Breakdown</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(score.breakdown).map(([key, value]) => (
              <div key={key} className="rounded-lg border bg-card/50 p-3">
                <div className="text-xs text-muted-foreground capitalize mb-1">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </div>
                <div className="text-lg font-semibold">{value}/10</div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Strengths & Weaknesses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-6">
          <div className="rounded-lg border bg-card/50 p-4">
            <h4 className="font-semibold text-green-600 dark:text-green-400 mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Key Strengths
            </h4>
            <ul className="text-sm space-y-1">
              {score.strengths.map((s, i) => (
                <li key={i} className="text-muted-foreground">• {s}</li>
              ))}
            </ul>
          </div>
          
          <div className="rounded-lg border bg-card/50 p-4">
            <h4 className="font-semibold text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Critical Weaknesses
            </h4>
            <ul className="text-sm space-y-1">
              {score.weaknesses.map((w, i) => (
                <li key={i} className="text-muted-foreground">• {w}</li>
              ))}
            </ul>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
          {score.alternatives && score.alternatives.length > 0 && score.total < 70 && (
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={handleRequestAlternative}
            >
              <Lightbulb className="mr-2 h-4 w-4" />
              Propose Better Topic
            </Button>
          )}
          <Button 
            className="flex-1"
            onClick={() => handleProceed(topic, score)}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Proceed With My Topic
          </Button>
        </div>
      </div>
    );
  }
  
  // Phase: Alternative
  if (phase === 'alternative' && alternativeScore && alternativeTopic) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-bold mb-6 text-center">💡 Improved Topic Suggestion</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-w-3xl mx-auto">
          {/* New Score Card */}
          <div className={cn(
            'rounded-xl p-6 text-center',
            getScoreColor(alternativeScore.total),
            'text-white'
          )}>
            <div className="text-5xl font-bold mb-1">{alternativeScore.total}</div>
            <div className="text-lg opacity-90">/100</div>
            <div className="mt-2 text-xl font-semibold">{alternativeScore.verdict}</div>
          </div>
          
          {/* New Topic Card */}
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold mb-2">NEW TITLE:</h3>
            <p className="text-lg font-medium text-primary mb-4">{alternativeTopic}</p>
            
            <h4 className="font-semibold mb-2 text-sm">WHY IT'S BETTER:</h4>
            <p className="text-sm text-muted-foreground">{alternativeScore.summary}</p>
          </div>
        </div>
        
        {/* Comparison */}
        <div className="max-w-3xl mx-auto mb-6 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Original</div>
              <div className="text-2xl font-bold">{score?.total || 0}</div>
            </div>
            <ArrowRight className="h-6 w-6 text-muted-foreground" />
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Improved</div>
              <div className="text-2xl font-bold text-green-500">
                {alternativeScore.total}
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Increase</div>
              <div className="text-2xl font-bold text-green-500">
                +{alternativeScore.total - (score?.total || 0)}
              </div>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
          <Button 
            variant="outline" 
            className="flex-1"
            onClick={() => handleProceed(topic, score!)}
          >
            ← Keep Original ({score?.total})
          </Button>
          <Button 
            className="flex-1"
            onClick={() => handleProceed(alternativeTopic, alternativeScore)}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Use This Topic ({alternativeScore.total})
          </Button>
        </div>
      </div>
    );
  }
  
  return null;
}
