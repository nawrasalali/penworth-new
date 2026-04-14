'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  BookOpen, 
  Star, 
  Filter,
  SlidersHorizontal,
  Grid,
  List,
  ChevronDown
} from 'lucide-react';
import Link from 'next/link';

interface MarketplaceListing {
  id: string;
  title: string;
  description: string;
  author_name: string;
  cover_url: string | null;
  price: number;
  currency: string;
  category: string;
  tags: string[];
  rating: number;
  reviews_count: number;
  downloads_count: number;
  created_at: string;
}

const categories = [
  'All Categories',
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

export default function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [sortBy, setSortBy] = useState('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    fetchListings();
  }, [selectedCategory, sortBy]);

  const fetchListings = async () => {
    try {
      const supabase = createClient();
      
      let query = supabase
        .from('marketplace_listings')
        .select('*')
        .eq('status', 'published');

      if (selectedCategory !== 'All Categories') {
        query = query.eq('category', selectedCategory);
      }

      // Sort
      switch (sortBy) {
        case 'newest':
          query = query.order('created_at', { ascending: false });
          break;
        case 'popular':
          query = query.order('downloads_count', { ascending: false });
          break;
        case 'rating':
          query = query.order('rating', { ascending: false });
          break;
        case 'price_low':
          query = query.order('price', { ascending: true });
          break;
        case 'price_high':
          query = query.order('price', { ascending: false });
          break;
      }

      const { data, error } = await query.limit(50);

      if (error) throw error;
      setListings(data || []);
    } catch (err) {
      console.error('Failed to fetch listings:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter(listing =>
    listing.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    listing.author_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    listing.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Marketplace</h1>
          <p className="text-gray-500 mt-1">
            Discover books created with Penworth AI
          </p>
        </div>
        <Link href="/marketplace/sell">
          <Button>
            <BookOpen className="h-4 w-4 mr-2" />
            Sell Your Book
          </Button>
        </Link>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search books, authors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="flex gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm bg-white"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm bg-white"
          >
            <option value="newest">Newest</option>
            <option value="popular">Most Popular</option>
            <option value="rating">Highest Rated</option>
            <option value="price_low">Price: Low to High</option>
            <option value="price_high">Price: High to Low</option>
          </select>

          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-white'}`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-white'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="aspect-[3/4] bg-gray-200" />
              <CardContent className="p-4 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No books found</h2>
          <p className="text-gray-500 mb-6">
            {searchQuery 
              ? 'Try adjusting your search or filters'
              : 'Be the first to list your book!'}
          </p>
          <Link href="/marketplace/sell">
            <Button>List Your Book</Button>
          </Link>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredListings.map((listing) => (
            <Link key={listing.id} href={`/marketplace/${listing.id}`}>
              <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group">
                <div className="aspect-[3/4] bg-gradient-to-br from-primary/20 to-primary/5 relative">
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
                  {listing.price === 0 && (
                    <Badge className="absolute top-2 right-2 bg-green-500">
                      Free
                    </Badge>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-900 group-hover:text-primary transition-colors line-clamp-1">
                    {listing.title}
                  </h3>
                  <p className="text-sm text-gray-500">{listing.author_name}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      <span className="text-sm font-medium">{listing.rating?.toFixed(1) || 'New'}</span>
                    </div>
                    <span className="text-gray-300">•</span>
                    <span className="text-sm text-gray-500">{listing.downloads_count || 0} downloads</span>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 flex items-center justify-between">
                  <Badge variant="outline">{listing.category}</Badge>
                  <span className="font-bold text-primary">
                    {listing.price === 0 ? 'Free' : `$${listing.price.toFixed(2)}`}
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredListings.map((listing) => (
            <Link key={listing.id} href={`/marketplace/${listing.id}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="p-4 flex gap-4">
                  <div className="w-24 h-32 bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex-shrink-0">
                    {listing.cover_url ? (
                      <img
                        src={listing.cover_url}
                        alt={listing.title}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="h-8 w-8 text-primary/30" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">{listing.title}</h3>
                        <p className="text-sm text-gray-500">{listing.author_name}</p>
                      </div>
                      <span className="font-bold text-primary text-lg">
                        {listing.price === 0 ? 'Free' : `$${listing.price.toFixed(2)}`}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{listing.description}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <Badge variant="outline">{listing.category}</Badge>
                      <div className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span className="text-sm">{listing.rating?.toFixed(1) || 'New'}</span>
                      </div>
                      <span className="text-sm text-gray-500">{listing.downloads_count || 0} downloads</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
