'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  ShieldCheck,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  ArrowRight,
  FileCheck
} from 'lucide-react';

interface QAScreenProps {
  qaChecks: { name: string; status: 'pending' | 'checking' | 'passed' | 'warning' | 'failed'; detail?: string }[];
  isChecking: boolean;
  onAcknowledge: () => void;
  locale?: Locale;
}

// Legal acknowledgement text is pulled live from the i18n bundle rather than
// hardcoded here — the checkbox IDs remain stable so that future consent-log
// writes can reference a canonical English doc_key regardless of the UI
// language the user saw.
function getLegalCheckboxes(locale: Locale) {
  return [
    { id: 'sole_responsibility', text: t('qa.consentResponsibility', locale) },
    { id: 'no_liability', text: t('qa.consentNoLiability', locale) },
    { id: 'no_infringement', text: t('qa.consentNoInfringement', locale) },
  ];
}

export function QAScreen({
  qaChecks,
  isChecking,
  onAcknowledge,
  locale = 'en',
}: QAScreenProps) {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const legalCheckboxes = getLegalCheckboxes(locale);
  
  const allChecked = legalCheckboxes.every(item => checkedItems[item.id]);
  const qaComplete = qaChecks.every(check => 
    check.status === 'passed' || check.status === 'warning'
  );
  
  const handleCheck = (id: string) => {
    setCheckedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'checking':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-xl font-bold">{t('qa.title', locale)}</h1>
        <p className="text-muted-foreground">
          {t('qa.subtitle', locale)}
        </p>
      </div>
      
      {/* QA Checks */}
      <div className="rounded-xl border bg-card p-6 mb-6">
        <div className="space-y-3">
          {qaChecks.map((check, idx) => (
            <div 
              key={idx}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg transition-colors',
                check.status === 'checking' && 'bg-primary/5',
                check.status === 'passed' && 'bg-green-500/5',
                check.status === 'warning' && 'bg-amber-500/5'
              )}
            >
              {getStatusIcon(check.status)}
              <span className={cn(
                'text-sm',
                check.status === 'pending' && 'text-muted-foreground'
              )}>
                {check.name}
              </span>
              {check.status === 'checking' && (
                <span className="text-xs text-primary ml-auto">{t('qa.checking', locale)}</span>
              )}
            </div>
          ))}
        </div>
        
        {isChecking && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            {t('qa.runningChecks', locale)}
          </div>
        )}
      </div>
      
      {/* Legal Acknowledgment */}
      {qaComplete && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold">{t('qa.legalRequired', locale)}</h3>
          </div>
          
          <p className="text-sm text-muted-foreground mb-4">
            {t('qa.legalIntro', locale)}
          </p>
          
          <div className="space-y-4">
            {legalCheckboxes.map((item) => (
              <label
                key={item.id}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  checkedItems[item.id] 
                    ? 'bg-primary/10 border-primary' 
                    : 'hover:bg-muted'
                )}
              >
                <input
                  type="checkbox"
                  checked={checkedItems[item.id] || false}
                  onChange={() => handleCheck(item.id)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm leading-relaxed">{item.text}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      
      {/* Continue Button */}
      <div className="flex justify-center">
        <Button
          onClick={onAcknowledge}
          disabled={!qaComplete || !allChecked}
          size="lg"
          className="min-w-[200px]"
        >
          <FileCheck className="mr-2 h-4 w-4" />
          {t('qa.agreeContinue', locale)}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      
      {qaComplete && !allChecked && (
        <p className="text-center text-sm text-muted-foreground mt-3">
          {t('qa.pleaseCheckAll', locale)}
        </p>
      )}
    </div>
  );
}
