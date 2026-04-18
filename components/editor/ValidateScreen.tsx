'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ValidationScore } from '@/types/agent-workflow';
import { getValidationRubric } from '@/lib/ai/interview-questions';
import { applyRubricLocale } from '@/lib/ai/rubric-i18n';
import { cn } from '@/lib/utils';
import { t, type Locale, type StringKey } from '@/lib/i18n/strings';
import {
  Sparkles,
  ArrowRight,
  Lightbulb,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Loader2,
  Target,
  Users,
  Zap,
  Wand2,
} from 'lucide-react';

export interface ProposedIdea {
  title: string;
  positioning: string;
  targetAudience: string;
  uniqueAngle: string;
  whyStronger: string[];
  addressedWeaknesses: string[];
  estimatedScore: ValidationScore;
}

interface ValidateScreenProps {
  onValidate: (topic: string) => Promise<ValidationScore>;
  onProposeStronger: (originalTopic: string, score: ValidationScore) => Promise<ProposedIdea>;
  onProceed: (topic: string, score: ValidationScore) => void;
  initialTopic?: string;
  contentType?: string | null;
  locale?: Locale;
}

type Phase = 'input' | 'validating' | 'results' | 'proposing' | 'compare';

// Score-breakdown keys are returned by the AI as the six canonical camelCase
// names (marketDemand, targetAudience, uniqueValue, authorCredibility,
// commercialViability, executionFeasibility). Map each to its translation key.
const BREAKDOWN_LABEL_KEYS: Record<string, StringKey> = {
  marketDemand: 'validate.breakdown.marketDemand',
  targetAudience: 'validate.breakdown.targetAudience',
  uniqueValue: 'validate.breakdown.uniqueValue',
  authorCredibility: 'validate.breakdown.authorCredibility',
  commercialViability: 'validate.breakdown.commercial',
  executionFeasibility: 'validate.breakdown.feasibility',
};

// Verdict tokens (STRONG/PROMISING/RISKY/RECONSIDER) arrive from the AI as
// canonical English enum values. Localise for display only.
function verdictLabel(verdict: ValidationScore['verdict'], locale: Locale): string {
  switch (verdict) {
    case 'STRONG': return t('validate.verdict.STRONG', locale);
    case 'PROMISING': return t('validate.verdict.PROMISING', locale);
    case 'RISKY': return t('validate.verdict.RISKY', locale);
    case 'RECONSIDER': return t('validate.verdict.RECONSIDER', locale);
  }
}

export function ValidateScreen({
  onValidate,
  onProposeStronger,
  onProceed,
  initialTopic = '',
  contentType,
  locale = 'en',
}: ValidateScreenProps) {
  const [phase, setPhase] = useState<Phase>('input');
  const [topic, setTopic] = useState(initialTopic);
  const [score, setScore] = useState<ValidationScore | null>(null);
  const [proposal, setProposal] = useState<ProposedIdea | null>(null);

  // Doc-type-aware copy: different document types see different intro,
  // labels, and placeholders on the Validate screen. `applyRubricLocale`
  // overlays the user's language onto the user-visible fields (intro,
  // inputLabel, inputPlaceholder, buttonLabel); the source rubric's
  // `expertise` and `criteria` are preserved verbatim for the server-side
  // AI prompt (which is English-only by design).
  const rubric = useMemo(
    () => applyRubricLocale(getValidationRubric(contentType), locale),
    [contentType, locale],
  );

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

  const handleProposeStronger = async () => {
    if (!score) return;
    setPhase('proposing');
    try {
      const prop = await onProposeStronger(topic, score);
      setProposal(prop);
      setPhase('compare');
    } catch (error) {
      console.error('Proposal failed:', error);
      setPhase('results');
    }
  };

  const getVerdictColor = (verdict: ValidationScore['verdict']) => {
    switch (verdict) {
      case 'STRONG': return 'text-green-600 dark:text-green-400';
      case 'PROMISING': return 'text-amber-600 dark:text-amber-400';
      case 'RISKY': return 'text-orange-600 dark:text-orange-400';
      case 'RECONSIDER': return 'text-red-600 dark:text-red-400';
    }
  };

  const getScoreColor = (total: number) => {
    if (total >= 80) return 'bg-green-500';
    if (total >= 60) return 'bg-amber-500';
    if (total >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // INPUT
  if (phase === 'input') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t('validate.title', locale)}</h1>
          <p className="text-muted-foreground">{rubric.intro}</p>
        </div>
        <div className="w-full space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {rubric.inputLabel}
          </label>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={rubric.inputPlaceholder}
            className="min-h-[150px] resize-none"
          />
          <Button onClick={handleValidate} className="w-full mt-3" disabled={!topic.trim()}>
            {rubric.buttonLabel} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // VALIDATING / PROPOSING
  if (phase === 'validating' || phase === 'proposing') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {phase === 'proposing' ? t('validate.crafting', locale) : t('validate.analyzing', locale)}
        </h2>
        <p className="text-muted-foreground text-center max-w-md">
          {phase === 'proposing'
            ? t('validate.craftingBody', locale)
            : t('validate.analyzingBody', locale)}
        </p>
      </div>
    );
  }

  // RESULTS
  if (phase === 'results' && score) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-bold mb-6 text-center">{t('validate.results', locale)}</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-w-3xl mx-auto">
          <div className={cn('rounded-xl p-6 text-center text-white', getScoreColor(score.total))}>
            <div className="text-5xl font-bold mb-1">{score.total}</div>
            <div className="text-lg opacity-90">/100</div>
            <div className="mt-2 text-xl font-semibold">{verdictLabel(score.verdict, locale)}</div>
          </div>
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              {t('validate.summary', locale)}
            </h3>
            <p className="text-sm text-muted-foreground">{score.summary}</p>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mb-6">
          <h3 className="font-semibold mb-3">{t('validate.scoreBreakdown', locale)}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(score.breakdown).map(([key, value]) => {
              const labelKey = BREAKDOWN_LABEL_KEYS[key];
              const label = labelKey ? t(labelKey, locale) : key.replace(/([A-Z])/g, ' $1').trim();
              return (
                <div key={key} className="rounded-lg border bg-card/50 p-3">
                  <div className="text-xs text-muted-foreground capitalize mb-1">{label}</div>
                  <div className="text-lg font-semibold">{value}/10</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-6">
          <div className="rounded-lg border bg-card/50 p-4">
            <h4 className="font-semibold text-green-600 dark:text-green-400 mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {t('validate.keyStrengths', locale)}
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
              {t('validate.criticalWeaknesses', locale)}
            </h4>
            <ul className="text-sm space-y-1">
              {score.weaknesses.map((w, i) => (
                <li key={i} className="text-muted-foreground">• {w}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
          <Button
            variant="outline"
            className="flex-1 border-primary/30 hover:bg-primary/5"
            onClick={handleProposeStronger}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {t('validate.proposeStronger', locale)}
          </Button>
          <Button className="flex-1" onClick={() => onProceed(topic, score)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {t('validate.proceedOriginal', locale)}
          </Button>
        </div>
      </div>
    );
  }

  // COMPARE — side by side
  if (phase === 'compare' && score && proposal) {
    const delta = proposal.estimatedScore.total - score.total;
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="text-center mb-4">
          <h1 className="text-xl font-bold mb-1">{t('validate.compare.title', locale)}</h1>
          <p className="text-sm text-muted-foreground">{t('validate.compare.subtitle', locale)}</p>
        </div>

        {/* Score headline */}
        <div className="max-w-4xl mx-auto mb-6 rounded-lg border bg-muted/30 p-4 flex items-center justify-around">
          <div className="text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('validate.compare.original', locale)}</div>
            <div className={cn('text-3xl font-bold', getVerdictColor(score.verdict))}>{score.total}</div>
          </div>
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('validate.compare.strongerVersion', locale)}</div>
            <div className={cn('text-3xl font-bold', getVerdictColor(proposal.estimatedScore.verdict))}>
              {proposal.estimatedScore.total}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('validate.compare.increase', locale)}</div>
            <div className={cn('text-3xl font-bold', delta > 0 ? 'text-green-500' : 'text-muted-foreground')}>
              {delta > 0 ? '+' : ''}{delta}
            </div>
          </div>
        </div>

        {/* Side-by-side cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mx-auto mb-6">
          {/* ORIGINAL */}
          <div className="rounded-xl border bg-card p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('validate.compare.yourOriginal', locale)}</span>
              <span className={cn('text-xl font-bold', getVerdictColor(score.verdict))}>{score.total}/100</span>
            </div>
            <p className="text-sm mb-4 min-h-[60px]">{topic}</p>

            <div className="text-xs font-semibold text-muted-foreground mb-2">{t('validate.compare.breakdown', locale)}</div>
            <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
              <Row label={t('validate.breakdown.marketDemand', locale)} value={score.breakdown.marketDemand} />
              <Row label={t('validate.breakdown.targetAudience', locale)} value={score.breakdown.targetAudience} />
              <Row label={t('validate.breakdown.uniqueValue', locale)} value={score.breakdown.uniqueValue} />
              <Row label={t('validate.breakdown.authorCredibility', locale)} value={score.breakdown.authorCredibility} />
              <Row label={t('validate.breakdown.commercial', locale)} value={score.breakdown.commercialViability} />
              <Row label={t('validate.breakdown.feasibility', locale)} value={score.breakdown.executionFeasibility} />
            </div>

            <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">{t('validate.compare.weaknesses', locale)}</div>
            <ul className="text-xs text-muted-foreground space-y-1 mb-4 flex-1">
              {score.weaknesses.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>

            <Button
              variant="outline"
              className="w-full mt-auto"
              onClick={() => onProceed(topic, score)}
            >
              {t('validate.compare.keepOriginal', locale)}
            </Button>
          </div>

          {/* STRONGER */}
          <div className="rounded-xl border-2 border-primary bg-card p-5 flex flex-col relative">
            <div className="absolute -top-2 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded">
              {t('validate.compare.recommended', locale)}
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('validate.compare.strongerVersion', locale)}</span>
              <span className={cn('text-xl font-bold', getVerdictColor(proposal.estimatedScore.verdict))}>
                {proposal.estimatedScore.total}/100
              </span>
            </div>
            <p className="text-sm font-semibold mb-2">{proposal.title}</p>
            <p className="text-xs text-muted-foreground mb-3 italic">{proposal.positioning}</p>

            <div className="grid grid-cols-1 gap-2 mb-4 text-xs">
              <div className="flex gap-2 items-start">
                <Users className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div><span className="font-semibold">{t('validate.compare.audienceLabel', locale)}</span> {proposal.targetAudience}</div>
              </div>
              <div className="flex gap-2 items-start">
                <Target className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div><span className="font-semibold">{t('validate.compare.angleLabel', locale)}</span> {proposal.uniqueAngle}</div>
              </div>
            </div>

            <div className="text-xs font-semibold text-muted-foreground mb-2">{t('validate.compare.breakdown', locale)}</div>
            <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
              <Row label={t('validate.breakdown.marketDemand', locale)} value={proposal.estimatedScore.breakdown.marketDemand} compare={score.breakdown.marketDemand} />
              <Row label={t('validate.breakdown.targetAudience', locale)} value={proposal.estimatedScore.breakdown.targetAudience} compare={score.breakdown.targetAudience} />
              <Row label={t('validate.breakdown.uniqueValue', locale)} value={proposal.estimatedScore.breakdown.uniqueValue} compare={score.breakdown.uniqueValue} />
              <Row label={t('validate.breakdown.authorCredibility', locale)} value={proposal.estimatedScore.breakdown.authorCredibility} compare={score.breakdown.authorCredibility} />
              <Row label={t('validate.breakdown.commercial', locale)} value={proposal.estimatedScore.breakdown.commercialViability} compare={score.breakdown.commercialViability} />
              <Row label={t('validate.breakdown.feasibility', locale)} value={proposal.estimatedScore.breakdown.executionFeasibility} compare={score.breakdown.executionFeasibility} />
            </div>

            <div className="text-xs font-semibold text-green-600 dark:text-green-400 mb-1">{t('validate.compare.whyStronger', locale)}</div>
            <ul className="text-xs text-muted-foreground space-y-1 mb-4 flex-1">
              {proposal.whyStronger.map((r, i) => (
                <li key={i} className="flex gap-1.5"><Zap className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />{r}</li>
              ))}
            </ul>

            <Button
              className="w-full mt-auto"
              onClick={() => onProceed(proposal.title, proposal.estimatedScore)}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {t('validate.compare.useStronger', locale)}
            </Button>
          </div>
        </div>

        {proposal.addressedWeaknesses.length > 0 && (
          <div className="max-w-5xl mx-auto rounded-lg border bg-primary/5 p-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              {t('validate.compare.addressedHow', locale)}
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              {proposal.addressedWeaknesses.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function Row({ label, value, compare }: { label: string; value: number; compare?: number }) {
  const delta = compare !== undefined ? value - compare : null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums flex items-center gap-1">
        {value}/10
        {delta !== null && delta !== 0 && (
          <span className={cn('text-[10px]', delta > 0 ? 'text-green-500' : 'text-red-500')}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </span>
    </div>
  );
}
