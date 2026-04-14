'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BookOpen, ChevronLeft, ChevronRight, Share2, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface Chapter {
  id: string;
  title: string;
  content: string;
  order_index: number;
}

interface BookData {
  title: string;
  description: string;
  chapters: Chapter[];
  author: {
    name: string;
    avatar: string | null;
  };
}

export default function ReadPage() {
  const params = useParams();
  const shareCode = params.code as string;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<BookData | null>(null);
  const [currentChapter, setCurrentChapter] = useState(0);

  useEffect(() => {
    fetchBook();
    trackClick();
  }, [shareCode]);

  const fetchBook = async () => {
    try {
      const supabase = createClient();
      
      // Fetch share link and associated book
      const { data: shareLink, error: slError } = await supabase
        .from('share_links')
        .select(`
          *,
          projects (
            title,
            description,
            chapters (*),
            profiles:user_id (full_name, avatar_url)
          )
        `)
        .eq('share_code', shareCode)
        .single();

      if (slError || !shareLink) {
        setError('Book not found');
        setLoading(false);
        return;
      }

      const project = shareLink.projects as any;
      const chapters = (project.chapters || []).sort(
        (a: Chapter, b: Chapter) => a.order_index - b.order_index
      );

      setBook({
        title: project.title,
        description: project.description,
        chapters,
        author: {
          name: project.profiles?.full_name || 'Anonymous',
          avatar: project.profiles?.avatar_url,
        },
      });
      setLoading(false);
    } catch (err) {
      setError('Failed to load book');
      setLoading(false);
    }
  };

  const trackClick = async () => {
    try {
      // Generate a simple fingerprint (IP + UA hash would be done server-side)
      const fingerprint = btoa(navigator.userAgent + new Date().toDateString()).slice(0, 32);
      
      const res = await fetch('/api/share/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareCode, fingerprint }),
      });
      
      // Silently track - don't block on errors
    } catch (err) {
      console.error('Track click error:', err);
    }
  };

  const shareBook = async () => {
    const shareUrl = window.location.href;
    const shareText = `Check out "${book?.title}" - written with Penworth AI!`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: book?.title,
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        // User cancelled or error
      }
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(shareUrl);
      alert('Link copied to clipboard!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-center">
          <BookOpen className="h-12 w-12 mx-auto text-primary mb-4" />
          <p className="text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <BookOpen className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Book Not Found</h2>
          <p className="text-gray-600 mb-6">{error || 'This book may have been removed or the link is invalid.'}</p>
          <Link href="/">
            <Button>Go to Penworth</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const chapter = book.chapters[currentChapter];

  return (
    <div className="min-h-screen bg-[#fdf6e3]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-semibold">
            <BookOpen className="h-5 w-5" />
            Penworth
          </Link>
          <Button variant="outline" size="sm" onClick={shareBook}>
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
        </div>
      </header>

      {/* Book Content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Title Section */}
        {currentChapter === 0 && (
          <div className="text-center mb-12">
            <h1 className="text-4xl font-serif font-bold text-gray-900 mb-4">
              {book.title}
            </h1>
            {book.description && (
              <p className="text-lg text-gray-600 mb-4">{book.description}</p>
            )}
            <p className="text-sm text-gray-500">
              by {book.author.name}
            </p>
          </div>
        )}

        {/* Chapter Navigation */}
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentChapter(Math.max(0, currentChapter - 1))}
            disabled={currentChapter === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-gray-500">
            Chapter {currentChapter + 1} of {book.chapters.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentChapter(Math.min(book.chapters.length - 1, currentChapter + 1))}
            disabled={currentChapter === book.chapters.length - 1}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Chapter Content */}
        <article className="prose prose-lg max-w-none">
          <h2 className="text-2xl font-serif font-semibold text-gray-900 mb-6">
            {chapter.title}
          </h2>
          <div className="text-gray-800 leading-relaxed whitespace-pre-wrap font-serif">
            {chapter.content}
          </div>
        </article>

        {/* Table of Contents */}
        <div className="mt-12 pt-8 border-t">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Table of Contents</h3>
          <ul className="space-y-2">
            {book.chapters.map((ch, idx) => (
              <li key={ch.id}>
                <button
                  onClick={() => setCurrentChapter(idx)}
                  className={`text-left w-full px-3 py-2 rounded-lg transition-colors ${
                    idx === currentChapter
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {idx + 1}. {ch.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>

      {/* CTA Footer */}
      <footer className="bg-gradient-to-br from-primary to-primary/80 text-white py-16 mt-12">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-2 text-sm mb-6">
            <Sparkles className="h-4 w-4" />
            Written with AI in under 48 hours
          </div>
          <h3 className="text-3xl font-bold mb-3">You have a book inside you.</h3>
          <p className="text-xl text-white/90 mb-8 max-w-xl mx-auto">
            Penworth transforms your ideas into a complete, publishable book. 
            No writing experience needed. Start free today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" variant="secondary" className="font-semibold text-lg px-8 py-6 h-auto">
                Start Writing for Free →
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" variant="outline" className="font-semibold text-lg px-8 py-6 h-auto border-white/30 text-white hover:bg-white/10">
                Learn More
              </Button>
            </Link>
          </div>
          <p className="text-sm text-white/70 mt-6">
            No credit card required • Publish to Amazon KDP for free
          </p>
        </div>
      </footer>

      {/* Sticky Mobile CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg sm:hidden z-50">
        <Link href="/signup" className="block">
          <Button size="lg" className="w-full font-semibold">
            <Sparkles className="h-4 w-4 mr-2" />
            Start Writing Your Book — Free
          </Button>
        </Link>
      </div>
    </div>
  );
}
