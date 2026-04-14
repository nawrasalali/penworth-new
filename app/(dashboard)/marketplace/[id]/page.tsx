'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BookOpen, 
  Star, 
  Download, 
  Share2, 
  Heart,
  ArrowLeft,
  User,
  Calendar,
  FileText,
  Check,
  Loader2
} from 'lucide-react';
import Link from 'next/link';

interface MarketplaceListing {
  id: string;
  title: string;
  description: string;
  long_description: string;
  author_name: string;
  author_id: string;
  cover_url: string | null;
  price: number;
  currency: string;
  category: string;
  tags: string[];
  rating: number;
  reviews_count: number;
  downloads_count: number;
  word_count: number;
  chapter_count: number;
  sample_content: string;
  created_at: string;
  profiles?: {
    full_name: string;
    avatar_url: string;
  };
}

export default function ListingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const listingId = params.id as string;

  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    fetchListing();
    checkUser();
  }, [listingId]);

  const fetchListing = async () => {
    try {
      const supabase = createClient();
      
      const { data, error } = await supabase
        .from('marketplace_listings')
        .select(`
          *,
          profiles:author_id (full_name, avatar_url)
        `)
        .eq('id', listingId)
        .single();

      if (error) throw error;
      setListing(data);
    } catch (err) {
      console.error('Failed to fetch listing:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkUser = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    
    if (user) {
      // Check if already purchased
      const { data: purchase } = await supabase
        .from('marketplace_purchases')
        .select('id')
        .eq('user_id', user.id)
        .eq('listing_id', listingId)
        .single();
      
      setPurchased(!!purchase);
    }
  };

  const handlePurchase = async () => {
    if (!user) {
      router.push(`/login?redirect=/marketplace/${listingId}`);
      return;
    }

    if (!listing) return;

    setPurchasing(true);
    try {
      if (listing.price === 0) {
        // Free download - just record the purchase
        const supabase = createClient();
        await supabase.from('marketplace_purchases').insert({
          user_id: user.id,
          listing_id: listing.id,
          price_paid: 0,
        });
        
        // Increment downloads count
        await supabase
          .from('marketplace_listings')
          .update({ downloads_count: (listing.downloads_count || 0) + 1 })
          .eq('id', listing.id);
        
        setPurchased(true);
      } else {
        // Paid - redirect to checkout
        const res = await fetch('/api/marketplace/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: listing.id }),
        });
        
        const { url } = await res.json();
        if (url) {
          window.location.href = url;
        }
      }
    } catch (err) {
      console.error('Purchase failed:', err);
    } finally {
      setPurchasing(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    if (navigator.share) {
      await navigator.share({
        title: listing?.title,
        text: `Check out "${listing?.title}" on Penworth`,
        url: shareUrl,
      });
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert('Link copied to clipboard!');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="text-center py-16">
        <BookOpen className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Book not found</h2>
        <p className="text-gray-500 mb-6">This listing may have been removed.</p>
        <Link href="/marketplace">
          <Button>Browse Marketplace</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/marketplace" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" />
        Back to Marketplace
      </Link>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column - Book Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex gap-6">
            {/* Cover Image */}
            <div className="w-48 h-64 flex-shrink-0 bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg overflow-hidden shadow-lg">
              {listing.cover_url ? (
                <img
                  src={listing.cover_url}
                  alt={listing.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="h-16 w-16 text-primary/30" />
                </div>
              )}
            </div>

            {/* Title & Meta */}
            <div className="flex-1">
              <Badge variant="outline" className="mb-2">{listing.category}</Badge>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{listing.title}</h1>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  {listing.profiles?.avatar_url ? (
                    <img
                      src={listing.profiles.avatar_url}
                      alt={listing.author_name}
                      className="h-8 w-8 rounded-full"
                    />
                  ) : (
                    <User className="h-4 w-4 text-primary" />
                  )}
                </div>
                <span className="font-medium">{listing.author_name}</span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="font-medium">{listing.rating?.toFixed(1) || 'New'}</span>
                  <span>({listing.reviews_count || 0} reviews)</span>
                </div>
                <div className="flex items-center gap-1">
                  <Download className="h-4 w-4" />
                  <span>{listing.downloads_count || 0} downloads</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date(listing.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {listing.tags?.map((tag, i) => (
                  <Badge key={i} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-xl font-semibold mb-4">About This Book</h2>
              <div className="prose prose-gray max-w-none">
                <p className="text-gray-700 whitespace-pre-wrap">
                  {listing.long_description || listing.description}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Book Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <FileText className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-2xl font-bold">{listing.chapter_count || '-'}</p>
                <p className="text-sm text-gray-500">Chapters</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <BookOpen className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-2xl font-bold">
                  {listing.word_count ? `${Math.round(listing.word_count / 1000)}k` : '-'}
                </p>
                <p className="text-sm text-gray-500">Words</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Star className="h-6 w-6 mx-auto text-primary mb-2" />
                <p className="text-2xl font-bold">{listing.rating?.toFixed(1) || 'New'}</p>
                <p className="text-sm text-gray-500">Rating</p>
              </CardContent>
            </Card>
          </div>

          {/* Sample Content */}
          {listing.sample_content && (
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold mb-4">Sample</h2>
                <div className="prose prose-gray max-w-none bg-gray-50 p-4 rounded-lg font-serif">
                  <p className="text-gray-700 whitespace-pre-wrap">{listing.sample_content}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Purchase Card */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardContent className="p-6 space-y-4">
              <div className="text-center">
                <p className="text-4xl font-bold text-primary">
                  {listing.price === 0 ? 'Free' : `$${listing.price.toFixed(2)}`}
                </p>
                {listing.price > 0 && (
                  <p className="text-sm text-gray-500">One-time purchase</p>
                )}
              </div>

              {purchased ? (
                <div className="space-y-3">
                  <Button className="w-full" size="lg">
                    <Download className="h-4 w-4 mr-2" />
                    Download Book
                  </Button>
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <Check className="h-4 w-4" />
                    <span className="text-sm">You own this book</span>
                  </div>
                </div>
              ) : (
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handlePurchase}
                  disabled={purchasing}
                >
                  {purchasing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : listing.price === 0 ? (
                    <Download className="h-4 w-4 mr-2" />
                  ) : null}
                  {listing.price === 0 ? 'Get Free' : 'Buy Now'}
                </Button>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleShare}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
                <Button variant="outline" className="flex-1">
                  <Heart className="h-4 w-4 mr-2" />
                  Wishlist
                </Button>
              </div>

              <div className="border-t pt-4 space-y-2">
                <h3 className="font-semibold">Includes</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    PDF format
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    EPUB format
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    Lifetime access
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    Free updates
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
