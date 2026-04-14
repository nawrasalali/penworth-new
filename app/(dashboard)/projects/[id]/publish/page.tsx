'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, Lock, ExternalLink, Download, BookOpen, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Platform {
  id: string;
  name: string;
  description: string;
  url: string;
  available: boolean;
  icon: string;
  requiredPlan?: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  status: string;
  metadata: any;
}

export default function PublishPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [userPlan, setUserPlan] = useState<string>('free');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [publishingData, setPublishingData] = useState<any>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [step, setStep] = useState<'select' | 'prepare' | 'instructions'>('select');

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!projectData) {
      router.push('/projects');
      return;
    }

    setProject(projectData);

    const res = await fetch('/api/publish');
    if (res.ok) {
      const data = await res.json();
      setPlatforms(data.platforms);
      setUserPlan(data.plan);
    }

    setIsLoading(false);
  };

  const handleSelectPlatform = (platformId: string) => {
    const platform = platforms.find(p => p.id === platformId);
    if (!platform?.available) return;
    
    setSelectedPlatform(platformId);
    setStep('prepare');
  };

  const handlePublish = async () => {
    if (!selectedPlatform || !project) return;

    setIsPublishing(true);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platform: selectedPlatform,
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Failed to prepare publishing');
        return;
      }

      setPublishingData(data);
      setStep('instructions');
    } catch (error) {
      alert('Failed to prepare publishing');
    } finally {
      setIsPublishing(false);
    }
  };

  const getPlatformIcon = (iconName: string) => {
    switch (iconName) {
      case 'amazon': return '📚';
      case 'book': return '📖';
      case 'share': return '🔗';
      case 'printer': return '🖨️';
      case 'play': return '▶️';
      default: return '📄';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) return null;

  if (project.status !== 'complete') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link href={`/projects/${projectId}/editor`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" />
          Back to Editor
        </Link>

        <div className="border rounded-lg p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Book Not Ready</h2>
          <p className="text-muted-foreground mb-4">
            Your book must be complete before you can publish. Current status: <strong>{project.status}</strong>
          </p>
          <Button asChild>
            <Link href={`/projects/${projectId}/editor`}>Continue Writing</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href={`/projects/${projectId}/editor`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Editor
      </Link>

      <h1 className="text-3xl font-bold mb-2">Publish Your Book</h1>
      <p className="text-muted-foreground mb-8">
        "{project.title}" • {project.metadata?.totalWordCount?.toLocaleString() || '—'} words
      </p>

      {/* Step 1: Select Platform */}
      {step === 'select' && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Choose a Publishing Platform</h2>
          
          <div className="grid gap-4 md:grid-cols-2">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                onClick={() => handleSelectPlatform(platform.id)}
                disabled={!platform.available}
                className={`text-left border rounded-lg p-4 transition-all ${
                  platform.available 
                    ? 'hover:border-primary hover:shadow-md cursor-pointer' 
                    : 'opacity-60 cursor-not-allowed'
                } ${selectedPlatform === platform.id ? 'border-primary ring-2 ring-primary/20' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getPlatformIcon(platform.icon)}</span>
                    <div>
                      <h3 className="font-semibold">{platform.name}</h3>
                      <p className="text-sm text-muted-foreground">{platform.description}</p>
                    </div>
                  </div>
                  {!platform.available && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="w-3 h-3" />
                      {platform.requiredPlan}
                    </div>
                  )}
                  {platform.available && (
                    <Check className="w-5 h-5 text-green-500" />
                  )}
                </div>
              </button>
            ))}
          </div>

          {userPlan === 'free' && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Free Plan:</strong> You can publish to Amazon KDP! 
                Upgrade to Max for access to all 5 publishing platforms.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Prepare */}
      {step === 'prepare' && selectedPlatform && (
        <div>
          <button 
            onClick={() => setStep('select')} 
            className="text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            ← Back to platform selection
          </button>

          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">
              Prepare for {platforms.find(p => p.id === selectedPlatform)?.name}
            </h2>

            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">1</div>
                <div>
                  <p className="font-medium">Export your manuscript</p>
                  <p className="text-sm text-muted-foreground">Download as DOCX or PDF from the editor</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">2</div>
                <div>
                  <p className="font-medium">Prepare your book cover</p>
                  <p className="text-sm text-muted-foreground">You'll need a professional cover image</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">3</div>
                <div>
                  <p className="font-medium">Get publishing instructions</p>
                  <p className="text-sm text-muted-foreground">We'll guide you through the process</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" asChild>
                <Link href={`/projects/${projectId}/editor`}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Manuscript
                </Link>
              </Button>
              <Button onClick={handlePublish} disabled={isPublishing}>
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  'Get Publishing Instructions'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Instructions */}
      {step === 'instructions' && publishingData && (
        <div>
          <button 
            onClick={() => setStep('select')} 
            className="text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            ← Start over
          </button>

          <div className="border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">
                Publishing to {publishingData.publishingData.platform}
              </h2>
              <Button asChild>
                <a href={publishingData.publishingData.uploadUrl} target="_blank" rel="noopener noreferrer">
                  Open {publishingData.publishingData.platform}
                  <ExternalLink className="w-4 h-4 ml-2" />
                </a>
              </Button>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 mb-6">
              <h3 className="font-medium mb-2">Your Book</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Title:</span>
                  <span className="ml-2">{publishingData.publishingData.title}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Word Count:</span>
                  <span className="ml-2">{publishingData.publishingData.wordCount?.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Chapters:</span>
                  <span className="ml-2">{publishingData.publishingData.chapterCount}</span>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="font-medium mb-2">Platform Requirements</h3>
              <div className="space-y-2 text-sm">
                {Object.entries(publishingData.publishingData.requirements || {}).map(([key, value]) => (
                  <div key={key} className="flex">
                    <span className="text-muted-foreground w-32 capitalize">{key.replace('_', ' ')}:</span>
                    <span>{value as string}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Step-by-Step Instructions</h3>
              <div className="bg-muted/30 rounded-lg p-4">
                <pre className="text-sm whitespace-pre-wrap font-sans">
                  {publishingData.message}
                </pre>
              </div>
            </div>

            {publishingData.publishingData.helpUrl && (
              <div className="mt-4 pt-4 border-t">
                <a 
                  href={publishingData.publishingData.helpUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Need more help? Visit {publishingData.publishingData.platform} Help Center →
                </a>
              </div>
            )}
          </div>

          <div className="mt-6 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg text-center">
            <p className="text-green-800 dark:text-green-200 mb-3">
              🎉 Congratulations on completing your book! Once published, readers will find it on {publishingData.publishingData.platform}.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">View All Projects</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
