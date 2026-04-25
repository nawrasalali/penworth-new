'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Copy,
  Share2,
  Users,
  Gift,
  CheckCircle2,
  Clock,
  Loader2,
  ArrowRight,
  BookOpen,
  Sparkles,
  Mail,
  MessageCircle,
  Twitter,
  Linkedin,
} from 'lucide-react';

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
  referee: { email: string; name: string };
}

interface ReferralData {
  referralCode: string;
  referralLink: string;
  creditsBalance: number;
  lifetimeCreditsEarned: number;
  stats: ReferralStats;
  referrals: Referral[];
}

const REWARD_CREDITS_PER_REFERRAL = 1_000;
const WELCOME_CREDITS = 100;
const GUILD_INVITE_THRESHOLD = 3;

export function ReferralDashboard() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    fetchReferralData();
  }, []);

  const fetchReferralData = async () => {
    try {
      const res = await fetch('/api/referrals');
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard blocked — fallthrough silently
    }
  };

  const shareNative = async () => {
    if (!data || typeof navigator === 'undefined' || !navigator.share) return;
    try {
      await navigator.share({
        title: 'Write your book with Penworth',
        text: `I'm using Penworth to write books. Sign up with my code ${data.referralCode} and get ${WELCOME_CREDITS} welcome credits.`,
        url: data.referralLink,
      });
    } catch {
      // User cancelled
    }
  };

  const showGuildBanner =
    !!data && data.stats.creditedReferrals >= GUILD_INVITE_THRESHOLD;

  const shareLinks = useMemo(() => {
    if (!data) return null;
    const text = `I'm writing books with Penworth. Use my code ${data.referralCode} to get ${WELCOME_CREDITS} welcome credits when you sign up:`;
    const url = data.referralLink;
    const enc = encodeURIComponent;
    return {
      twitter: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
      email: `mailto:?subject=${enc('Try Penworth — write your book with AI')}&body=${enc(`${text}\n\n${url}`)}`,
      whatsapp: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-8 text-center text-neutral-500">
        Could not load referral data. Please refresh and try again.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* HERO — value proposition + share affordances */}
      <div className="rounded-3xl bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 p-8 sm:p-10">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-200 mb-4">
              <Sparkles className="h-3 w-3" />
              Refer a friend, write a free book
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              Share Penworth. Earn one full book per friend who publishes.
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
              When someone signs up with your code, they get{' '}
              <strong className="text-neutral-900 dark:text-neutral-100">
                {WELCOME_CREDITS} welcome credits
              </strong>
              . When they publish their first book, you earn{' '}
              <strong className="text-neutral-900 dark:text-neutral-100">
                {REWARD_CREDITS_PER_REFERRAL.toLocaleString()} credits
              </strong>
              {' '}— enough for a full book of your own. No cap on how many
              friends you can refer.
            </p>
          </div>

          <div className="lg:w-[26rem] w-full space-y-3">
            <div className="rounded-2xl bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm border border-amber-200/60 dark:border-amber-800/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                Your code
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-2xl font-bold text-neutral-900 dark:text-white tracking-wider">
                  {data.referralCode}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy(data.referralCode, 'code')}
                  className="shrink-0"
                >
                  {copied === 'code' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl bg-white/70 dark:bg-neutral-900/60 backdrop-blur-sm border border-amber-200/60 dark:border-amber-800/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2">
                Your link
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={data.referralLink}
                  className="flex-1 bg-transparent text-sm text-neutral-700 dark:text-neutral-300 font-mono truncate focus:outline-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy(data.referralLink, 'link')}
                  className="shrink-0"
                >
                  {copied === 'link' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 pt-1">
              {shareLinks && (
                <>
                  <a
                    href={shareLinks.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-white/70 dark:bg-neutral-900/60 py-2.5 text-xs font-medium hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                  >
                    <Twitter className="h-3.5 w-3.5" /> X
                  </a>
                  <a
                    href={shareLinks.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-white/70 dark:bg-neutral-900/60 py-2.5 text-xs font-medium hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                  >
                    <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                  </a>
                  <a
                    href={shareLinks.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-white/70 dark:bg-neutral-900/60 py-2.5 text-xs font-medium hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                  <a
                    href={shareLinks.email}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-white/70 dark:bg-neutral-900/60 py-2.5 text-xs font-medium hover:bg-white dark:hover:bg-neutral-800 transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </a>
                </>
              )}
            </div>

            {typeof navigator !== 'undefined' &&
              typeof (navigator as Navigator).share === 'function' && (
                <Button
                  onClick={shareNative}
                  className="w-full bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share via system menu
                </Button>
              )}
          </div>
        </div>
      </div>

      {/* GUILD UPGRADE BANNER — appears at 3+ successful referrals */}
      {showGuildBanner && (
        <div className="rounded-3xl bg-gradient-to-r from-[#1a1f2e] to-[#0f1219] dark:from-[#1a1f2e] dark:to-[#0f1219] border border-[#d4af37]/40 p-8 text-white">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 justify-between">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/30 px-3 py-1 text-xs font-medium text-[#d4af37] mb-3">
                <Sparkles className="h-3 w-3" />
                You've earned this
              </div>
              <h3 className="text-2xl font-bold mb-2">
                You've helped {data.stats.creditedReferrals} authors publish.
                Time to earn cash, not credits.
              </h3>
              <p className="text-neutral-300 leading-relaxed max-w-2xl">
                The Penworth Guild pays{' '}
                <strong className="text-[#d4af37]">20–40% recurring commission</strong>{' '}
                in cash on every paid subscription you bring in, for 12
                months — not one-off credits. If you're already this good
                at sharing Penworth, the Guild is built for you.
              </p>
            </div>
            <Link href="/guild/apply" className="shrink-0">
              <Button className="bg-[#d4af37] hover:bg-[#e6c14a] text-black font-semibold">
                Apply to the Guild
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* STAT CARDS — three, not four (no fabricated 'pending' filler) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Gift className="h-5 w-5 text-amber-500" />
              <Badge variant="secondary" className="text-xs">
                Available now
              </Badge>
            </div>
            <div className="text-3xl font-bold text-neutral-900 dark:text-white">
              {data.creditsBalance.toLocaleString()}
            </div>
            <div className="text-sm text-neutral-500 mt-1">
              Credits balance
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-5 w-5 text-blue-500" />
              <Badge variant="secondary" className="text-xs">
                Lifetime
              </Badge>
            </div>
            <div className="text-3xl font-bold text-neutral-900 dark:text-white">
              {data.stats.creditedReferrals}
            </div>
            <div className="text-sm text-neutral-500 mt-1">
              Friends who published
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <BookOpen className="h-5 w-5 text-green-500" />
              <Badge variant="secondary" className="text-xs">
                Earned
              </Badge>
            </div>
            <div className="text-3xl font-bold text-neutral-900 dark:text-white">
              {data.stats.totalCreditsEarned.toLocaleString()}
            </div>
            <div className="text-sm text-neutral-500 mt-1">
              Credits earned from referrals
            </div>
          </CardContent>
        </Card>
      </div>

      {/* HOW IT WORKS — three steps, sober tone */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-8">
        <h3 className="text-lg font-semibold mb-6">How it works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Step
            n={1}
            title="Share your code"
            body="Send your link to a friend who's been thinking about writing a book. Most authors share with one or two close contacts at a time — that's the highest-converting approach."
          />
          <Step
            n={2}
            title="They sign up & write"
            body={`Your friend gets ${WELCOME_CREDITS} welcome credits the moment they create their account. They can start writing immediately on the free plan.`}
          />
          <Step
            n={3}
            title="You earn a free book"
            body={`When your friend publishes their first book, ${REWARD_CREDITS_PER_REFERRAL.toLocaleString()} credits land in your account — exactly one document at standard pricing. No cap on referrals.`}
          />
        </div>
      </div>

      {/* GUILD UPSELL — present even before threshold for awareness */}
      {!showGuildBanner && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a1f2e] shrink-0">
              <Sparkles className="h-5 w-5 text-[#d4af37]" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-neutral-900 dark:text-white mb-1">
                Want cash instead of credits?
              </h4>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3 leading-relaxed">
                The Penworth Guild pays 20–40% recurring commission in cash
                on paid subscriptions, for 12 months per referral. Built for
                authors who want to grow Penworth as a sales partner, not
                just an occasional sharer.
              </p>
              <Link
                href="/guild"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
              >
                Learn about the Guild
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY — empty state or list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            Your referrals ({data.stats.totalReferrals})
          </h3>
        </div>

        {data.referrals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center">
            <Users className="h-8 w-8 text-neutral-400 mx-auto mb-3" />
            <p className="text-neutral-500 mb-1">No referrals yet</p>
            <p className="text-sm text-neutral-400">
              Share your code with one author you trust. Word of mouth from a
              published friend converts far better than any ad.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800 overflow-hidden">
            {data.referrals.map((ref) => (
              <ReferralRow key={ref.id} referral={ref} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-sm font-bold mb-3">
        {n}
      </div>
      <h4 className="font-semibold text-neutral-900 dark:text-white mb-1.5">
        {title}
      </h4>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function ReferralRow({ referral }: { referral: Referral }) {
  const isCredited = referral.status === 'credited';
  const date = new Date(referral.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="flex items-center justify-between p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${
            isCredited
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
              : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
          }`}
        >
          {isCredited ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Clock className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm text-neutral-900 dark:text-white truncate">
            {referral.referee.name || 'Anonymous'}
          </div>
          <div className="text-xs text-neutral-500 truncate">
            {referral.referee.email} · joined {date}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        {isCredited ? (
          <>
            <div className="text-sm font-semibold text-green-700 dark:text-green-400">
              +{referral.creditsAwarded.toLocaleString()} credits
            </div>
            <div className="text-xs text-neutral-500">Published</div>
          </>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Awaiting first book
          </Badge>
        )}
      </div>
    </div>
  );
}
