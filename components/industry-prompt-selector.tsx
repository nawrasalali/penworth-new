'use client';

import { useState, useEffect } from 'react';
import { Check, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface Prompt {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: string;
  available: boolean;
  exampleTopics: string[];
}

interface IndustryPromptSelectorProps {
  value: string;
  onChange: (value: string) => void;
  onCustomInstructionsChange?: (value: string) => void;
  customInstructions?: string;
}

export function IndustryPromptSelector({
  value,
  onChange,
  onCustomInstructionsChange,
  customInstructions,
}: IndustryPromptSelectorProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [plan, setPlan] = useState<string>('free');
  const [canUseCustom, setCanUseCustom] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    fetchPrompts();
  }, []);

  const fetchPrompts = async () => {
    try {
      const res = await fetch('/api/prompts');
      if (res.ok) {
        const data = await res.json();
        setPrompts(data.prompts);
        setPlan(data.plan);
        setCanUseCustom(data.canUseCustom);
      }
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPrompt = prompts.find(p => p.id === value);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-10 bg-muted rounded" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Writing Style</label>
        {plan !== 'max' && (
          <Link href="/billing" className="text-xs text-primary hover:underline">
            Upgrade to unlock all styles
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => prompt.available && onChange(prompt.id)}
            disabled={!prompt.available}
            className={`relative text-left p-3 rounded-lg border transition-all ${
              value === prompt.id
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : prompt.available
                ? 'hover:border-primary/50 hover:bg-muted/50'
                : 'opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="text-xl">{prompt.icon}</span>
              {!prompt.available && (
                <Lock className="w-3 h-3 text-muted-foreground" />
              )}
              {value === prompt.id && prompt.available && (
                <Check className="w-4 h-4 text-primary" />
              )}
            </div>
            <p className="font-medium text-sm mt-2">{prompt.name}</p>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {prompt.description}
            </p>
          </button>
        ))}
      </div>

      {/* Selected prompt details */}
      {selectedPrompt && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{selectedPrompt.icon}</span>
            <span className="font-medium">{selectedPrompt.name}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {selectedPrompt.description}
          </p>
          <div className="text-xs">
            <span className="text-muted-foreground">Great for: </span>
            {selectedPrompt.exampleTopics.join(', ')}
          </div>
        </div>
      )}

      {/* Custom instructions (Max only) */}
      {canUseCustom && (
        <div className="pt-4 border-t">
          <button
            type="button"
            onClick={() => setShowCustom(!showCustom)}
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Sparkles className="w-4 h-4" />
            {showCustom ? 'Hide' : 'Add'} custom AI instructions
          </button>

          {showCustom && (
            <div className="mt-3">
              <textarea
                value={customInstructions || ''}
                onChange={(e) => onCustomInstructionsChange?.(e.target.value)}
                placeholder="Add specific instructions for how the AI should write your book... (e.g., 'Include case studies from tech startups' or 'Write in a conversational, first-person style')"
                className="w-full h-24 px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Max plan feature: Customize AI behavior with specific instructions
              </p>
            </div>
          )}
        </div>
      )}

      {!canUseCustom && plan !== 'free' && (
        <div className="pt-4 border-t">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />
            <span>Custom AI instructions available on Max plan</span>
            <Link href="/billing" className="text-primary hover:underline ml-auto">
              Upgrade
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default IndustryPromptSelector;
