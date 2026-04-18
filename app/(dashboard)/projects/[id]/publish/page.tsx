'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Rocket,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  Sparkles,
  BookOpen,
  Globe,
  Store,
  ArrowLeft
} from 'lucide-react';

interface PublishingPlatform {
  id: string;
  name: string;
  slug: string;
  description: string;
  website_url: string;
  platform_type: 'self_publish' | 'traditional' | 'marketplace' | 'aggregator';
  display_order: number;
}

interface ProjectData {
  id: string;
  title: string;
  description: string;
  content_type: string;
  status: string;
  metadata: {
    author_name?: string;
    about_author?: string;
    word_count?: number;
    chapter_count?: number;
  };
}

function PublishingPageContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  
  const [platforms, setPlatforms] = useState<PublishingPlatform[]>([]);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [generatingGuide, setGeneratingGuide] = useState<string | null>(null);
  const [publishingToPenworth, setPublishingToPenworth] = useState(false);
  const [publishedToPenworth, setPublishedToPenworth] = useState(false);
  const [generatedGuides, setGeneratedGuides] = useState<Record<string, string>>({});
  
  const supabase = createClient();
  
  useEffect(() => {
    loadData();
  }, [projectId]);
  
  const loadData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      
      // Load platforms from database
      const { data: platformsData } = await supabase
        .from('publishing_platforms')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      
      // Load project
      const { data: projectData } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
      
      if (platformsData) setPlatforms(platformsData);
      if (projectData) setProject(projectData);
      
      // Check if already published to Penworth
      if (projectData) {
        const { data: listing } = await supabase
          .from('marketplace_listings')
          .select('id')
          .eq('project_id', projectId)
          .eq('status', 'published')
          .single();
        
        if (listing) setPublishedToPenworth(true);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handlePublishToPenworth = async () => {
    if (!project) return;
    
    setPublishingToPenworth(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Get user's tier (profiles.plan is the actual column — the
      // old code queried 'subscription_tier' which doesn't exist and
      // made isFreeTier always return true, letting every user
      // publish to the Free tier of Penworth Store regardless of
      // their actual plan).
      const { data: profile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single();
      
      const isFreeTier = !profile?.plan || profile.plan === 'free';
      
      // Create marketplace listing.
      // Schema note: 'status' = 'published' serves as the publish-state
      // flag. There is no 'published_at' column — the created_at timestamp
      // captures when status transitioned to 'published' in practice
      // because rows are inserted straight into that state.
      const { error } = await supabase
        .from('marketplace_listings')
        .insert({
          project_id: project.id,
          seller_id: user.id,
          title: project.title,
          description: project.description,
          status: 'published',
          is_free_tier: isFreeTier,
          word_count: project.metadata?.word_count || 0,
          chapter_count: project.metadata?.chapter_count || 0,
        });
      
      if (error) throw error;
      
      setPublishedToPenworth(true);
    } catch (error) {
      console.error('Error publishing to Penworth:', error);
    } finally {
      setPublishingToPenworth(false);
    }
  };
  
  const handleGenerateGuide = async (platform: PublishingPlatform) => {
    if (!project) return;
    
    setGeneratingGuide(platform.id);
    try {
      const response = await fetch('/api/publishing/generate-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          platformSlug: platform.slug,
          projectData: {
            title: project.title,
            description: project.description,
            authorName: project.metadata?.author_name || 'Author',
            aboutAuthor: project.metadata?.about_author || '',
            wordCount: project.metadata?.word_count || 0,
            chapterCount: project.metadata?.chapter_count || 0,
            contentType: project.content_type,
          }
        })
      });
      
      const data = await response.json();
      
      if (data.guide) {
        setGeneratedGuides(prev => ({
          ...prev,
          [platform.id]: data.guide
        }));
      }
    } catch (error) {
      console.error('Error generating guide:', error);
    } finally {
      setGeneratingGuide(null);
    }
  };
  
  const handleDownloadGuide = (platform: PublishingPlatform) => {
    const guide = generatedGuides[platform.id];
    if (!guide) return;
    
    const blob = new Blob([guide], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.title || 'book'}-${platform.slug}-guide.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const getPlatformIcon = (type: string) => {
    switch (type) {
      case 'marketplace': return <Store className="h-5 w-5" />;
      case 'self_publish': return <BookOpen className="h-5 w-5" />;
      case 'aggregator': return <Globe className="h-5 w-5" />;
      default: return <BookOpen className="h-5 w-5" />;
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!project) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }
  
  const penworthPlatform = platforms.find(p => p.slug === 'penworth');
  const otherPlatforms = platforms.filter(p => p.slug !== 'penworth');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Link 
            href={`/projects/${projectId}/editor`} 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Editor
          </Link>
          
          <div className="flex items-center gap-3 mb-2">
            <Rocket className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Publish Your Work</h1>
          </div>
          <p className="text-muted-foreground">
            Choose where to publish "{project.title}". Generate platform-specific guides with all the details you need.
          </p>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Penworth Marketplace - Featured */}
        {penworthPlatform && (
          <div className="mb-8">
            <div className={cn(
              'rounded-xl border-2 overflow-hidden',
              publishedToPenworth ? 'border-green-500 bg-green-500/5' : 'border-primary bg-primary/5'
            )}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'h-12 w-12 rounded-xl flex items-center justify-center',
                      publishedToPenworth ? 'bg-green-500' : 'bg-primary'
                    )}>
                      <Sparkles className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{penworthPlatform.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {penworthPlatform.description}
                      </p>
                    </div>
                  </div>
                  
                  {publishedToPenworth ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="h-5 w-5" />
                      <span className="font-medium">Published!</span>
                    </div>
                  ) : (
                    <Button
                      onClick={handlePublishToPenworth}
                      disabled={publishingToPenworth}
                      size="lg"
                      className="bg-gradient-to-r from-primary to-amber-500"
                    >
                      {publishingToPenworth ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Rocket className="mr-2 h-4 w-4" />
                      )}
                      One-Click Publish
                    </Button>
                  )}
                </div>
                
                <div className="rounded-lg bg-background/50 p-4">
                  <h4 className="font-medium mb-2">Why Penworth Marketplace?</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>✓ Instant publication - no manual work required</li>
                    <li>✓ We handle all formatting and distribution</li>
                    <li>✓ Reach readers in the Penworth ecosystem</li>
                    <li>✓ Set your own pricing (coming soon)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Other Platforms */}
        <h3 className="font-semibold text-lg mb-4">Other Publishing Platforms ({otherPlatforms.length})</h3>
        
        <div className="space-y-3">
          {otherPlatforms.map((platform) => (
            <div 
              key={platform.id}
              className="rounded-xl border bg-card overflow-hidden"
            >
              {/* Platform Header */}
              <button
                onClick={() => setExpandedPlatform(
                  expandedPlatform === platform.id ? null : platform.id
                )}
                className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                    {getPlatformIcon(platform.platform_type)}
                  </div>
                  <div className="text-left">
                    <h3 className="font-medium">{platform.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize">
                      {platform.platform_type.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                
                {expandedPlatform === platform.id ? (
                  <ChevronUp className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
              
              {/* Expanded Content */}
              {expandedPlatform === platform.id && (
                <div className="p-4 pt-0 border-t">
                  <p className="text-sm text-muted-foreground mb-4">
                    {platform.description}
                  </p>
                  
                  {/* Generated Guide Preview */}
                  {generatedGuides[platform.id] && (
                    <div className="rounded-lg bg-muted/50 p-4 mb-4 max-h-60 overflow-y-auto">
                      <h4 className="font-medium text-sm mb-2">Your Publishing Guide:</h4>
                      <pre className="text-xs whitespace-pre-wrap font-mono">
                        {generatedGuides[platform.id].slice(0, 1000)}
                        {generatedGuides[platform.id].length > 1000 && '...'}
                      </pre>
                    </div>
                  )}
                  
                  <div className="flex flex-wrap gap-2">
                    {!generatedGuides[platform.id] ? (
                      <Button
                        onClick={() => handleGenerateGuide(platform)}
                        disabled={generatingGuide === platform.id}
                      >
                        {generatingGuide === platform.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Generate Publishing Guide
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleDownloadGuide(platform)}
                        variant="default"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download Guide
                      </Button>
                    )}
                    
                    <Button
                      variant="outline"
                      onClick={() => window.open(platform.website_url, '_blank')}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Visit {platform.name.split(' ')[0]}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        
        {/* Back Button */}
        <div className="mt-8 text-center">
          <Button
            variant="outline"
            onClick={() => router.push(`/projects/${projectId}`)}
          >
            ← Back to Project
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function PublishingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <PublishingPageContent />
    </Suspense>
  );
}
