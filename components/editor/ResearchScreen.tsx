'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResearchResource } from '@/types/agent-workflow';
import { cn } from '@/lib/utils';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  FlaskConical,
  CheckCircle2,
  Circle,
  Loader2,
  Link,
  Upload,
  X,
  Plus,
  ArrowRight,
  FileText
} from 'lucide-react';

interface ResearchScreenProps {
  resources: ResearchResource[];
  isResearching: boolean;
  researchSteps: { text: string; completed: boolean }[];
  onToggleResource: (id: string) => void;
  onAddUrl: (url: string) => void;
  onUploadFile: (file: File) => void;
  onRemoveResource: (id: string) => void;
  onApprove: () => void;
  locale?: Locale;
}

export function ResearchScreen({
  resources,
  isResearching,
  researchSteps,
  onToggleResource,
  onAddUrl,
  onUploadFile,
  onRemoveResource,
  onApprove,
  locale = 'en',
}: ResearchScreenProps) {
  const [newUrl, setNewUrl] = useState('');
  
  const handleAddUrl = () => {
    if (!newUrl.trim()) return;
    onAddUrl(newUrl);
    setNewUrl('');
  };
  
  const generatedResources = resources.filter(r => r.type === 'generated');
  const userResources = resources.filter(r => r.type !== 'generated');
  const selectedCount = resources.filter(r => r.isSelected).length;

  return (
    <div className="flex-1 flex flex-col p-6 max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">{t('research.title', locale)}</h1>
        </div>
      </div>
      
      {/* Live Research Feed */}
      <div className="rounded-xl border bg-card p-4 mb-6">
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground">
          {t('research.liveFeed', locale)}
        </h3>
        <div className="space-y-2">
          {researchSteps.map((step, idx) => (
            <div 
              key={idx}
              className={cn(
                'flex items-center gap-2 text-sm',
                step.completed ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {step.completed ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
              ) : isResearching && idx === researchSteps.findIndex(s => !s.completed) ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 flex-shrink-0" />
              )}
              <span>{step.text}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Select Research to Include */}
      {generatedResources.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">{t('research.selectInclude', locale)}</h3>
          <div className="space-y-2">
            {generatedResources.map((resource) => (
              <label
                key={resource.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  resource.isSelected 
                    ? 'bg-primary/10 border-primary' 
                    : 'hover:bg-muted'
                )}
              >
                <input
                  type="checkbox"
                  checked={resource.isSelected}
                  onChange={() => onToggleResource(resource.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{resource.title}</div>
                  {resource.summary && (
                    <div className="text-xs text-muted-foreground truncate">
                      {resource.summary}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
      
      {/* Add Your Own Resources */}
      <div className="rounded-xl border bg-muted/30 p-4 mb-6">
        <h3 className="font-semibold mb-3">{t('research.addYourOwn', locale)}</h3>
        
        {/* URL Input */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://..."
              className="pl-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddUrl();
              }}
            />
          </div>
          <Button onClick={handleAddUrl} disabled={!newUrl.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        {/* File Upload */}
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('research.uploadResearchDoc', locale)}</span>
          <Button variant="outline" size="sm" asChild className="ml-auto">
            <label className="cursor-pointer">
              {t('research.chooseFile', locale)}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(file);
                }}
              />
            </label>
          </Button>
        </div>
        
        {/* User's Resources */}
        {userResources.length > 0 && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{t('research.yourResources', locale)}</h4>
            {userResources.map((resource) => (
              <div
                key={resource.id}
                className="flex items-center gap-2 text-sm bg-background rounded-lg px-3 py-2"
              >
                {resource.type === 'url' ? (
                  <Link className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">
                  {resource.title || resource.url || resource.filePath}
                </span>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <button
                  onClick={() => onRemoveResource(resource.id)}
                  className="p-1 hover:bg-muted rounded"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Approve Button */}
      <div className="flex justify-center">
        <Button
          onClick={onApprove}
          disabled={isResearching || selectedCount === 0}
          size="lg"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {t('research.approveContinue', locale)}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
      
      {selectedCount === 0 && !isResearching && (
        <p className="text-center text-sm text-muted-foreground mt-3">
          {t('research.selectAtLeastOne', locale)}
        </p>
      )}
    </div>
  );
}
