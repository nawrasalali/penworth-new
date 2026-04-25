'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  BookOpen,
  HelpCircle,
  MessageSquare,
  Sparkles,
  CreditCard,
  Users,
  Download,
  ChevronDown,
  Mail,
  Search,
  CheckCircle2,
  Clock,
  Handshake,
  Store as StoreIcon,
  Shield,
  ScrollText,
  ExternalLink,
  Zap,
  Receipt,
  Rocket,
  Star,
} from 'lucide-react';

// FAQ content stays English for now. Translating substantive Q+A pairs
// across 11 locales requires native review (contractual / billing
// implications, product claims, regional nuance) that a single machine
// pass can't validate. The CHROME around them is localised.
//
// Updated 2026-04-25: economics reflect post-rewrite values
// (1000 referral credits, 100 welcome, no cap; Apprentice 3 free books;
// Pro $19, Max $49).
const faqs = [
  {
    category: 'Getting Started',
    icon: BookOpen,
    color: 'text-amber-600 dark:text-amber-500',
    bg: 'bg-amber-500/10',
    questions: [
      {
        q: 'How do I start writing my first book?',
        a: 'Click "New Project" from your dashboard, choose your book type, and Penworth will guide you through a short interview to capture your vision. The AI then drafts an outline and writes chapter by chapter under your direction. You stay in control of every word.',
      },
      {
        q: 'What types of books can I write?',
        a: 'Fiction (novels, short stories, screenplays), non-fiction (memoirs, business, self-help, academic), poetry, technical writing, and more. The AI adapts its style to match your genre, and you can always paste in samples to anchor the voice.',
      },
      {
        q: 'How long does it take to write a book?',
        a: 'Most authors complete a first draft in 48 to 72 hours of focused work. Penworth handles the heavy generation while you make the creative calls.',
      },
      {
        q: 'Do I own what I write?',
        a: 'Yes. You retain full copyright over everything you produce on Penworth. We do not train models on your work, do not share it, and do not claim any rights.',
      },
    ],
  },
  {
    category: 'AI Writing',
    icon: Sparkles,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/10',
    questions: [
      {
        q: 'How does the AI understand my writing style?',
        a: 'During the initial interview, the AI captures your voice, preferred pacing, and tonal choices. You can refine the style profile any time, paste in writing samples, or override individual passages.',
      },
      {
        q: 'Can I edit what the AI writes?',
        a: 'Every word is editable. Treat AI output as a starting draft — refine, restructure, or replace anything that is not yours.',
      },
      {
        q: 'Is my content original?',
        a: 'Yes. Generation is fresh per request and grounded in your specific inputs. Your manuscript is private to your account.',
      },
      {
        q: 'Which AI models are available?',
        a: 'Free: Claude Haiku. Pro: Haiku + Sonnet. Max: Haiku + Sonnet + Opus. Higher-tier models produce more nuanced prose at a higher credit cost per generation.',
      },
    ],
  },
  {
    category: 'Credits & Billing',
    icon: CreditCard,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
    questions: [
      {
        q: 'How do credits work?',
        a: 'One full document costs 1,000 credits at standard pricing. Free accounts get one free document in their first month. Pro is 2,000 credits/month, Max is 5,000 credits/month with rollover. You can top up any plan with credit packs (1,000 / 3,000 / 10,000 credits).',
      },
      {
        q: 'How does the referral programme work?',
        a: 'Share your referral code. New users get 100 welcome credits when they sign up. When they publish their first book, you earn 1,000 credits (one full document on us) — no lifetime cap. Sustained referrers should look at the Guild for cash commission instead.',
      },
      {
        q: "What's included in the Pro plan?",
        a: 'Pro is $19/month: 2,000 credits/month, watermark-free exports (PDF + DOCX), Sonnet model access, Store-listing eligibility (15% commission), email support.',
      },
      {
        q: "What's included in the Max plan?",
        a: 'Max is $49/month: 5,000 credits/month with 2,500 rollover, all export formats including EPUB, Opus model access, all five publishing connectors (KDP / IngramSpark / D2D / Lulu / Google Play), priority support.',
      },
      {
        q: 'Can I cancel my subscription?',
        a: 'Yes — anytime, from Billing settings. You keep access until the end of your billing period. No early-termination fees.',
      },
    ],
  },
  {
    category: 'Publishing & Export',
    icon: Download,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    questions: [
      {
        q: 'How do I export my book?',
        a: 'Open your project and click Export. Free accounts export to PDF with a small "Written with Penworth" watermark. Pro removes the watermark and adds DOCX. Max adds EPUB. Top up your account or earn credits via referrals to remove the watermark on free.',
      },
      {
        q: 'Can I publish on Amazon KDP or other stores?',
        a: 'Yes. Pro plans support direct KDP publishing. Max plans include KDP, IngramSpark, Draft2Digital, Lulu, and Google Play. You can also export and upload manually anywhere.',
      },
      {
        q: 'What about book covers?',
        a: 'Penworth generates AI cover designs as part of the publishing flow. You can regenerate, customise prompts, or upload your own cover image at any point.',
      },
      {
        q: 'Can I sell my book on the Penworth Store?',
        a: 'Yes — Pro and Max users can list completed books on store.penworth.ai. Penworth keeps a 15% commission; you keep the rest. Visual Audiobook and Cinematic Livebook formats are launching for Store-listed titles.',
      },
    ],
  },
  {
    category: 'Guild & Referrals',
    icon: Users,
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10',
    questions: [
      {
        q: 'What is the Penworth Guild?',
        a: 'The Guild is our partner programme. Members earn 20–40% recurring cash commission for 12 months on every paid subscription they refer. Guild requires application and a voice interview. Apprentices receive 3 free books on join, and must remain on Pro or Max from month four ("walk the talk"). See guild.penworth.ai.',
      },
      {
        q: 'How do I apply for the Guild?',
        a: 'Visit guild.penworth.ai and submit an application. The process includes a short voice interview so we can get to know you. Approved applicants receive an Apprentice tier slot and onboarding to the Academy. Applications are reviewed in batches; expect a response within a few days.',
      },
      {
        q: 'How is the Guild different from referrals?',
        a: 'Casual referrals pay credits (one-shot, on first book publish). Guild pays cash (recurring, on paid subscriptions). The two complement each other — sustained sharers should be in the Guild.',
      },
    ],
  },
];

const POPULAR = [
  { category: 'Getting Started', q: 'How do I start writing my first book?' },
  { category: 'Credits & Billing', q: 'How do credits work?' },
  { category: 'Credits & Billing', q: 'How does the referral programme work?' },
  { category: 'Publishing & Export', q: 'How do I export my book?' },
];

const QUICK_LINKS = [
  { label: 'Pricing', href: '/billing', icon: Receipt },
  { label: 'Penworth Guild', href: 'https://guild.penworth.ai', icon: Handshake, external: true },
  { label: 'Penworth Store', href: 'https://store.penworth.ai', icon: StoreIcon, external: true },
  { label: 'Terms of Service', href: '/legal/terms', icon: ScrollText },
  { label: 'Privacy Policy', href: '/legal/privacy', icon: Shield },
  { label: 'Acceptable Use', href: '/legal/acceptable-use', icon: ScrollText },
];

export default function HelpPage() {
  const [locale, setLocale] = useState<Locale>('en');
  const [query, setQuery] = useState('');
  const [openFaqKey, setOpenFaqKey] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('preferred_language, full_name, email')
          .eq('id', user.id)
          .single();
        if (data?.preferred_language) setLocale(data.preferred_language as Locale);
        if (data?.full_name) setContactName((prev) => prev || data.full_name);
        const userEmail = data?.email || user.email;
        if (userEmail) setContactEmail((prev) => prev || userEmail);
      } catch {
        // stay on 'en'
      }
    };
    load();
  }, []);

  // Search across all FAQs. When query is non-empty, the category grid
  // is replaced with a flat result list so users see matches regardless
  // of which category they live in.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hits: Array<{ category: string; q: string; a: string; idx: number }> = [];
    faqs.forEach((cat) => {
      cat.questions.forEach((qa, idx) => {
        if (
          qa.q.toLowerCase().includes(q) ||
          qa.a.toLowerCase().includes(q) ||
          cat.category.toLowerCase().includes(q)
        ) {
          hits.push({ category: cat.category, q: qa.q, a: qa.a, idx });
        }
      });
    });
    return hits;
  }, [query]);

  const popularQAs = useMemo(() => {
    return POPULAR.map((p) => {
      const cat = faqs.find((c) => c.category === p.category);
      const qa = cat?.questions.find((qq) => qq.q === p.q);
      return cat && qa ? { category: cat.category, icon: cat.icon, color: cat.color, bg: cat.bg, q: qa.q, a: qa.a } : null;
    }).filter(Boolean) as Array<{
      category: string;
      icon: typeof BookOpen;
      color: string;
      bg: string;
      q: string;
      a: string;
    }>;
  }, []);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactName,
          email: contactEmail,
          message: contactMessage,
        }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else if (res.status === 429) {
        setErrorMessage(t('help.rateLimited', locale));
      } else {
        setErrorMessage(t('help.sendError', locale));
      }
    } catch {
      setErrorMessage(t('help.sendError', locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-10 pb-12">
      {/* HERO — search-first, with reassurance strip beneath */}
      <section className="rounded-3xl bg-gradient-to-br from-neutral-50 via-amber-50/40 to-neutral-50 dark:from-neutral-950 dark:via-amber-950/20 dark:to-neutral-950 border border-neutral-200/60 dark:border-neutral-800/60 p-8 sm:p-12">
        <div className="max-w-3xl mx-auto text-center space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-200">
            <HelpCircle className="h-3 w-3" />
            We&apos;re here to help
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            How can we help you today?
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400 max-w-xl mx-auto">
            Search the knowledge base, browse common questions, or get in
            touch with our support team directly.
          </p>
          <div className="relative max-w-2xl mx-auto pt-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400 mt-1" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for an answer…"
              className="w-full rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-12 pr-4 py-4 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              aria-label="Search FAQs"
            />
          </div>
        </div>
      </section>

      {/* STATUS / PROMISE / CONTACT strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 shrink-0">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">All systems operational</div>
            <div className="text-xs text-neutral-500 truncate">
              No active incidents
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Typical reply time</div>
            <div className="text-xs text-neutral-500 truncate">
              Within 24 hours, weekdays
            </div>
          </div>
        </div>
        <a
          href="mailto:support@penworth.ai"
          className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 flex items-center gap-3 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 shrink-0">
            <Mail className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Email support</div>
            <div className="text-xs text-neutral-500 truncate">
              support@penworth.ai
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </a>
      </section>

      {/* SEARCH RESULTS — shown when query non-empty, replaces categories */}
      {searchResults !== null && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {searchResults.length === 0
                ? `No results for "${query}"`
                : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query}"`}
            </h2>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-sm text-amber-600 dark:text-amber-400 hover:underline"
            >
              Clear search
            </button>
          </div>
          {searchResults.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center">
              <Search className="h-8 w-8 text-neutral-400 mx-auto mb-3" />
              <p className="text-neutral-600 dark:text-neutral-400 mb-1">
                We couldn&apos;t find a matching answer.
              </p>
              <p className="text-sm text-neutral-500">
                Try different keywords, or{' '}
                <a
                  href="#contact-form"
                  className="text-amber-600 dark:text-amber-400 hover:underline"
                >
                  message the support team
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((r, i) => {
                const key = `search-${i}`;
                const isOpen = openFaqKey === key;
                return (
                  <FaqItem
                    key={key}
                    isOpen={isOpen}
                    onToggle={() => setOpenFaqKey(isOpen ? null : key)}
                    category={r.category}
                    question={r.q}
                    answer={r.a}
                    showCategory
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* POPULAR — only shown when not searching */}
      {searchResults === null && (
        <section>
          <div className="flex items-baseline gap-3 mb-4">
            <Star className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-semibold">Popular questions</h2>
            <span className="text-sm text-neutral-500">
              The four answers most authors look for
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {popularQAs.map((p, i) => {
              const key = `popular-${i}`;
              const isOpen = openFaqKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpenFaqKey(isOpen ? null : key)}
                  className={`text-left rounded-2xl border p-5 transition-all ${
                    isOpen
                      ? 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-amber-500/30'
                  }`}
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${p.bg} shrink-0`}>
                      <p.icon className={`h-4 w-4 ${p.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-neutral-500 mb-1">
                        {p.category}
                      </div>
                      <div className="font-semibold text-sm leading-snug">
                        {p.q}
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-neutral-400 shrink-0 mt-1 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                  {isOpen && (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed mt-3 pl-11">
                      {p.a}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* CATEGORIES — full FAQ grid, only shown when not searching */}
      {searchResults === null && (
        <section id="faqs" className="scroll-mt-6">
          <div className="flex items-baseline gap-3 mb-4">
            <Zap className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-semibold">Browse by category</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {faqs.map((category) => (
              <div
                key={category.category}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden flex flex-col"
              >
                <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/30 flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${category.bg}`}>
                    <category.icon className={`h-4 w-4 ${category.color}`} />
                  </div>
                  <div>
                    <div className="font-semibold">{category.category}</div>
                    <div className="text-xs text-neutral-500">
                      {category.questions.length} questions
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800 flex-1">
                  {category.questions.map((qa, idx) => {
                    const key = `${category.category}-${idx}`;
                    const isOpen = openFaqKey === key;
                    return (
                      <FaqItem
                        key={key}
                        isOpen={isOpen}
                        onToggle={() => setOpenFaqKey(isOpen ? null : key)}
                        question={qa.q}
                        answer={qa.a}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CONTACT FORM */}
      <section id="contact-form" className="scroll-mt-6">
        <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 shrink-0">
                <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">
                  {t('help.stillNeedHelpTitle', locale)}
                </h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                  {t('help.stillNeedHelpSubtitle', locale)}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 sm:p-8">
            {submitted ? (
              <div className="text-center py-8">
                <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">
                  {t('help.messageSent', locale)}
                </h3>
                <p className="text-neutral-500 max-w-md mx-auto">
                  {t('help.messageSentBody', locale).replace(
                    '{email}',
                    contactEmail,
                  )}
                </p>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => {
                    setSubmitted(false);
                    setContactMessage('');
                    setErrorMessage(null);
                  }}
                >
                  {t('help.sendAnother', locale)}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">
                      {t('help.nameLabel', locale)}
                    </label>
                    <Input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder={t('help.namePlaceholder', locale)}
                      required
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">
                      {t('help.emailLabel', locale)}
                    </label>
                    <Input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder={t('help.emailPlaceholder', locale)}
                      required
                      maxLength={320}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1.5">
                    {t('help.messageLabel', locale)}
                  </label>
                  <Textarea
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder={t('help.messagePlaceholder', locale)}
                    rows={5}
                    required
                    maxLength={5000}
                  />
                  <div className="text-xs text-neutral-500 mt-1.5">
                    {contactMessage.length} / 5000 characters
                  </div>
                </div>
                {errorMessage && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800/40 p-3 text-sm text-red-700 dark:text-red-400">
                    {errorMessage}
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-neutral-500">
                    We typically reply within 24 hours on weekdays.
                  </p>
                  <Button type="submit" disabled={submitting} className="shrink-0">
                    {submitting
                      ? t('help.sending', locale)
                      : t('help.sendMessage', locale)}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER quick links */}
      <section>
        <div className="flex items-baseline gap-3 mb-4">
          <Rocket className="h-5 w-5 text-amber-500" />
          <h2 className="text-xl font-semibold">Quick links</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {QUICK_LINKS.map((link) =>
            link.external ? (
              <a
                key={link.label}
                href={link.href}
                rel="noopener noreferrer"
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors group"
              >
                <link.icon className="h-5 w-5 text-neutral-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors mb-2" />
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {link.label}
                  <ExternalLink className="h-3 w-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </a>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors group"
              >
                <link.icon className="h-5 w-5 text-neutral-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors mb-2" />
                <div className="text-sm font-medium">{link.label}</div>
              </Link>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function FaqItem({
  isOpen,
  onToggle,
  question,
  answer,
  category,
  showCategory,
}: {
  isOpen: boolean;
  onToggle: () => void;
  question: string;
  answer: string;
  category?: string;
  showCategory?: boolean;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-start justify-between gap-4 px-5 py-4 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors"
      >
        <div className="min-w-0">
          {showCategory && category && (
            <div className="text-xs font-medium text-neutral-500 mb-1">
              {category}
            </div>
          )}
          <div className="font-medium text-sm">{question}</div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-neutral-400 shrink-0 mt-1 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="px-5 pb-4 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}
