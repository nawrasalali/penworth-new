'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  BookOpen, 
  DollarSign, 
  Tag,
  FileText,
  ArrowLeft,
  Loader2,
  Check,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';

interface Project {
  id: string;
  title: string;
  description: string;
  status: string;
  chapters: { id: string; content: string }[];
}

const categories = [
  'Fiction',
  'Non-Fiction',
  'Business',
  'Self-Help',
  'Biography',
  'Science',
  'Technology',
  'Health',
  'Romance',
  'Mystery',
  'Fantasy',
  'Children',
];

export default function SellPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [step, setStep] = useState(1);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [price, setPrice] = useState('0');
  const [sampleContent, setSampleContent] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/login?redirect=/marketplace/sell');
        return;
      }

      const { data, error } = await supabase
        .from('projects')
        .select(`
          id,
          title,
          description,
          status,
          chapters (id, content)
        `)
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProject = (project: Project) => {
    setSelectedProject(project);
    setTitle(project.title);
    setDescription(project.description || '');
    
    // Generate sample from first chapter
    if (project.chapters?.length > 0) {
      const firstChapter = project.chapters[0];
      setSampleContent(firstChapter.content?.slice(0, 500) || '');
    }
    
    setStep(2);
  };

  const addTag = () => {
    if (tagInput.trim() && tags.length < 5 && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = async () => {
    if (!selectedProject || !title || !description || !category) {
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      // Calculate word count
      const wordCount = selectedProject.chapters?.reduce((sum, ch) => {
        return sum + (ch.content?.split(/\s+/).length || 0);
      }, 0) || 0;

      // Create marketplace listing.
      //
      // Schema alignment fixes (previously 5 fields were silently dropped
      // on every submission, causing listings to be unlinked from their
      // seller and lose price data):
      //
      // 1. author_id  → seller_id    (schema uses seller_id)
      // 2. author_name                → dropped; resolved via profiles join on read
      // 3. category                   → prepended to tags array; no dedicated column
      // 4. price (float dollars)      → price_cents (integer cents)
      // 5. currency: 'USD'            → dropped; store is USD-only
      //
      // Category is preserved by prepending it to tags so the 'category'
      // constant in the UI still maps to something queryable in the DB.
      const priceCents = Math.round((parseFloat(price) || 0) * 100);
      const listingTags = category
        ? [category.toLowerCase(), ...tags]
        : tags;

      const { data, error } = await supabase
        .from('marketplace_listings')
        .insert({
          project_id: selectedProject.id,
          seller_id: user.id,
          title,
          description,
          long_description: longDescription,
          tags: listingTags,
          price_cents: priceCents,
          sample_content: sampleContent,
          word_count: wordCount,
          chapter_count: selectedProject.chapters?.length || 0,
          status: 'published',
        })
        .select()
        .single();

      if (error) throw error;

      router.push(`/marketplace/${data.id}`);
    } catch (err) {
      console.error('Failed to create listing:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link href="/marketplace" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Marketplace
        </Link>
        <h1 className="text-3xl font-bold">Sell Your Book</h1>
        <p className="text-gray-500 mt-1">
          List your completed book on the Penworth marketplace
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-primary' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
            {step > 1 ? <Check className="h-4 w-4" /> : '1'}
          </div>
          <span className="font-medium">Select Book</span>
        </div>
        <div className="flex-1 h-0.5 bg-gray-200">
          <div className={`h-full bg-primary transition-all ${step >= 2 ? 'w-full' : 'w-0'}`} />
        </div>
        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary' : 'text-gray-400'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
            2
          </div>
          <span className="font-medium">Listing Details</span>
        </div>
      </div>

      {/* Step 1: Select Book */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select a Book to Sell</CardTitle>
            <CardDescription>
              Choose from your completed books. Only finished books can be listed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No completed books</h3>
                <p className="text-gray-500 mb-4">
                  You need to complete a book before you can list it for sale.
                </p>
                <Link href="/projects/new">
                  <Button>Start Writing</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleSelectProject(project)}
                    className="w-full p-4 border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-16 bg-primary/10 rounded flex items-center justify-center flex-shrink-0">
                        <BookOpen className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{project.title}</h3>
                        <p className="text-sm text-gray-500 line-clamp-2">{project.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span>{project.chapters?.length || 0} chapters</span>
                          <Badge variant="outline" className="text-green-600">Completed</Badge>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Listing Details */}
      {step === 2 && selectedProject && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Listing Details</CardTitle>
              <CardDescription>
                Provide details about your book to attract readers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Book title"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Short Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief summary (shown in search results)"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Full Description</label>
                <Textarea
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  placeholder="Detailed description of your book (shown on the listing page)"
                  rows={4}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="">Select a category</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Tags (up to 5)</label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="Add a tag"
                  />
                  <Button type="button" variant="outline" onClick={addTag}>
                    <Tag className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                      {tag} ×
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <CardDescription>
                Set your book's price. Free books get more downloads.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-gray-400" />
                <Input
                  type="number"
                  min="0"
                  step="0.99"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-32"
                />
                <span className="text-gray-500">USD</span>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPrice('0')}
                >
                  Set as Free
                </Button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                {parseFloat(price) === 0 
                  ? 'Your book will be free to download'
                  : `You'll earn $${(parseFloat(price) * 0.85).toFixed(2)} per sale (85% after fees)`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sample Content</CardTitle>
              <CardDescription>
                Provide a preview for potential readers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={sampleContent}
                onChange={(e) => setSampleContent(e.target.value)}
                placeholder="Paste a sample from your book (first chapter recommended)"
                rows={6}
              />
              <p className="text-sm text-gray-500 mt-2">
                This preview will be shown to readers before they purchase
              </p>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button 
              className="flex-1"
              onClick={handleSubmit}
              disabled={submitting || !title || !description || !category}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Publish Listing
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
