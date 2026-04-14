'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Copy, Share2, Users, Gift, TrendingUp, CheckCircle2, Clock, Loader2 } from 'lucide-react';

interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  creditedReferrals: number;
  totalCreditsEarned: number;
}

interface Referral {
  id: string;
  status: 'pending' | 'qualified' | 'credited';
  creditsAwarded: number;
  createdAt: string;
  qualifiedAt: string | null;
  referee: {
    email: string;
    name: string;
  };
}

interface ReferralData {
  referralCode: string;
  referralLink: string;
  creditsBalance: number;
  lifetimeCreditsEarned: number;
  stats: ReferralStats;
  referrals: Referral[];
}

export function ReferralDashboard() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchReferralData();
  }, []);

  const fetchReferralData = async () => {
    try {
      const res = await fetch('/api/referrals');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareReferral = async () => {
    if (!data) return;
    
    const shareText = `Write your book with AI! Use my referral code ${data.referralCode} to get 50 bonus credits.`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join Penworth',
          text: shareText,
          url: data.referralLink,
        });
      } catch (err) {
        // User cancelled
      }
    } else {
      copyToClipboard(data.referralLink);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          Failed to load referral data
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Referral Link Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Your Referral Link
          </CardTitle>
          <CardDescription>
            Share your unique link and earn 500 credits when friends complete their first book
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input 
              value={data.referralLink} 
              readOnly 
              className="font-mono text-sm"
            />
            <Button 
              variant="outline" 
              onClick={() => copyToClipboard(data.referralLink)}
            >
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button onClick={shareReferral}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </Button>
          </div>
          <p className="text-sm text-gray-500">
            Your code: <span className="font-mono font-semibold">{data.referralCode}</span>
          </p>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <Gift className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.creditsBalance}</p>
                <p className="text-sm text-gray-500">Credits Balance</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.totalCreditsEarned}</p>
                <p className="text-sm text-gray-500">Credits Earned</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.totalReferrals}</p>
                <p className="text-sm text-gray-500">Total Referrals</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-yellow-100">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{data.stats.pendingReferrals}</p>
                <p className="text-sm text-gray-500">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* How It Works */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mb-3">
                1
              </div>
              <h3 className="font-semibold mb-1">Share Your Link</h3>
              <p className="text-sm text-gray-500">
                Send your unique referral link to friends who want to write a book
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mb-3">
                2
              </div>
              <h3 className="font-semibold mb-1">They Sign Up</h3>
              <p className="text-sm text-gray-500">
                Your friend creates an account and gets 50 welcome credits
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mb-3">
                3
              </div>
              <h3 className="font-semibold mb-1">You Earn Credits</h3>
              <p className="text-sm text-gray-500">
                When they complete their first book, you earn 500 credits!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Referral History */}
      {data.referrals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Referral History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.referrals.map((referral) => (
                <div 
                  key={referral.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                >
                  <div>
                    <p className="font-medium">{referral.referee.name}</p>
                    <p className="text-sm text-gray-500">{referral.referee.email}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={
                      referral.status === 'credited' ? 'default' :
                      referral.status === 'qualified' ? 'secondary' : 'outline'
                    }>
                      {referral.status === 'credited' ? 'Completed' :
                       referral.status === 'qualified' ? 'Qualified' : 'Pending'}
                    </Badge>
                    {referral.creditsAwarded > 0 && (
                      <p className="text-sm text-green-600 mt-1">
                        +{referral.creditsAwarded} credits
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit Cap Notice */}
      <p className="text-sm text-center text-gray-500">
        Maximum {300} credits can be earned from referrals. You've earned {data.lifetimeCreditsEarned} of {300}.
      </p>
    </div>
  );
}
