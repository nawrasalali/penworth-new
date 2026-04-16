'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  BookOpen,
  FileText,
  Briefcase,
  GraduationCap,
  Landmark,
  Code,
  FileSpreadsheet,
  File,
  ArrowLeft,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { CONTENT_TYPE_LABELS, INDUSTRY_LABELS } from '@/lib/utils';
import type { ContentType, Visibility } from '@/types';

const contentTypeIcons: Record<string, any> = {
  book: BookOpen,
  paper: FileText,
  business_plan: Briefcase,
  financial_model: FileSpreadsheet,
  educational: GraduationCap,
  policy: Landmark,
  technical_doc: Code,
  report: FileText,
  other: File,
};

const contentTypeDescriptions: Record<string, string> = {
  book: 'Write a complete book with chapters, outlines, and professional formatting.',
  paper: 'Create academic papers with proper citations and research methodology.',
  business_plan: 'Develop comprehensive business plans for investors or internal use.',
  financial_model: 'Build financial projections and analysis documents.',
  educational: 'Design curriculum materials, lesson plans, and learning content.',
  policy: 'Draft policy documents, procedures, and governance materials.',
  technical_doc: 'Create API documentation, technical guides, and specifications.',
  report: 'Generate reports, analyses, and summaries.',
  other: 'Custom content that doesn\'t fit other categories.',
};

function NewProjectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedType = searchParams.get('type') as ContentType | null;

  const [step, setStep] = useState(preselectedType ? 2 : 1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    content_type: preselectedType || '' as ContentType,
    visibility: 'private' as Visibility,
  });

  const handleTypeSelect = (type: ContentType) => {
    setFormData({ ...formData, content_type: type });
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content_type) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Please log in to create a project');
        return;
      }

      const { data: project, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title: formData.title,
          description: formData.description,
          content_type: formData.content_type,
          visibility: formData.visibility,
          status: 'draft',
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Project created successfully!');
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error('Error creating project:', error);
      toast.error('Failed to create project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </button>
        <h1 className="text-3xl font-bold tracking-tight">Create New Project</h1>
        <p className="text-muted-foreground mt-1">
          {step === 1 ? 'Choose the type of content you want to create' : 'Enter your project details'}
        </p>
      </div>

      {/* Step 1: Select Content Type */}
      {step === 1 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(CONTENT_TYPE_LABELS).map(([type, label]) => {
            const Icon = contentTypeIcons[type] || File;
            return (
              <Card
                key={type}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => handleTypeSelect(type as ContentType)}
              >
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{label}</h3>
                  <p className="text-sm text-muted-foreground">
                    {contentTypeDescriptions[type]}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Step 2: Project Details */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              {formData.content_type && (
                <>
                  {(() => {
                    const Icon = contentTypeIcons[formData.content_type] || File;
                    return (
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                    );
                  })()}
                  <div>
                    <CardTitle>{CONTENT_TYPE_LABELS[formData.content_type]}</CardTitle>
                    <CardDescription>
                      <button
                        onClick={() => setStep(1)}
                        className="text-primary hover:underline"
                      >
                        Change type
                      </button>
                    </CardDescription>
                  </div>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium">
                  Project Title <span className="text-destructive">*</span>
                </label>
                <Input
                  id="title"
                  placeholder="Enter a title for your project"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="description"
                  placeholder="Briefly describe what this project is about..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Visibility</label>
                <div className="flex gap-4">
                  {(['private', 'org', 'public'] as Visibility[]).map((v) => (
                    <label
                      key={v}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                        formData.visibility === v
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={v}
                        checked={formData.visibility === v}
                        onChange={(e) => setFormData({ ...formData, visibility: e.target.value as Visibility })}
                        className="sr-only"
                      />
                      <span className="capitalize">{v === 'org' ? 'Organization' : v}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formData.visibility === 'private' && 'Only you can see this project'}
                  {formData.visibility === 'org' && 'All members of your organization can see this project'}
                  {formData.visibility === 'public' && 'Anyone can see this project'}
                </p>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create Project
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={
      <div className="p-8 max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <NewProjectContent />
    </Suspense>
  );
}
