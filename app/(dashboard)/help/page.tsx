'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { t, type Locale } from '@/lib/i18n/strings';
import {
  BookOpen,
  HelpCircle,
  MessageSquare,
  FileText,
  Sparkles,
  CreditCard,
  Users,
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  ExternalLink,
} from 'lucide-react';

// FAQ content stays English for now. Translating 15 substantive Q+A pairs
// correctly across 11 locales requires native review (contractual /
// billing implications, product claims, regional nuance) that a single
// machine pass can't validate. The CHROME around them is localised so a
// non-English user's page header, quick-link cards, contact form, and
// success/error states render in their language.
const faqs = [
  {
    category: 'Getting Started',
    icon: BookOpen,
    questions: [
      {
        q: 'How do I start writing my first book?',
        a: 'Click "New Project" from your dashboard, choose your book type (fiction, non-fiction, etc.), and our AI will guide you through an interview to understand your vision. Then it will generate an outline and help you write chapter by chapter.',
      },
      {
        q: 'What types of books can I write?',
        a: 'Penworth supports fiction (novels, short stories), non-fiction (memoirs, business books, self-help), educational content, and more. Our AI adapts its writing style to match your genre.',
      },
      {
        q: 'How long does it take to write a book?',
        a: 'Most users complete their first draft in 48-72 hours! The AI does the heavy lifting while you guide the creative direction.',
      },
    ],
  },
  {
    category: 'AI Writing',
    icon: Sparkles,
    questions: [
      {
        q: 'How does the AI understand my writing style?',
        a: 'During the initial interview, the AI learns your preferences, voice, and goals. You can also provide writing samples or adjust the style at any time.',
      },
      {
        q: 'Can I edit what the AI writes?',
        a: 'Absolutely! Every word is editable. The AI provides a foundation that you can refine, expand, or completely rewrite to match your vision.',
      },
      {
        q: 'Is my content original?',
        a: 'Yes. The AI generates unique content based on your inputs. Your book is yours - we never share or reuse your content.',
      },
    ],
  },
  {
    category: 'Credits & Billing',
    icon: CreditCard,
    questions: [
      {
        q: 'How do credits work?',
        a: 'Credits are used for AI generation. Free users get a welcome bonus. You earn more credits through referrals (500 credits per friend who completes their first book) or by upgrading to a paid plan.',
      },
      {
        q: "What's included in the Pro plan?",
        a: 'Pro includes unlimited AI generations, watermark-free exports, priority support, and access to advanced features like multiple book projects and collaboration tools.',
      },
      {
        q: 'Can I cancel my subscription?',
        a: "Yes, you can cancel anytime from your Billing settings. You'll retain access until the end of your billing period.",
      },
    ],
  },
  {
    category: 'Publishing & Export',
    icon: Download,
    questions: [
      {
        q: 'How do I export my book?',
        a: 'Click "Export" in your project to download as PDF or DOCX. Free users get exports with "Written with Penworth" branding; Pro users get clean exports.',
      },
      {
        q: 'Can I publish on Amazon KDP?',
        a: 'Yes! Export your book as a properly formatted file and upload directly to Amazon KDP, IngramSpark, or any other publishing platform.',
      },
      {
        q: 'Do you help with book covers?',
        a: 'Cover design tools are coming soon! For now, we recommend Canva or hiring a designer for your cover.',
      },
    ],
  },
  {
    category: 'Teams & Collaboration',
    icon: Users,
    questions: [
      {
        q: 'Can I invite collaborators?',
        a: "Yes! You can invite co-authors to review and edit your manuscript. They'll receive an email invitation to join your project.",
      },
      {
        q: "What's the difference between reviewer and editor roles?",
        a: 'Reviewers can read and comment on your manuscript. Editors can also make direct changes to the text.',
      },
      {
        q: 'How does the Team plan work?',
        a: 'Team plans allow multiple users under one subscription with shared billing, organization management, and collaborative features.',
      },
    ],
  },
];

export default function HelpPage() {
  const [locale, setLocale] = useState<Locale>('en');
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load user's preferred language so chrome renders in their locale.
  // Also pre-fills name/email when available so they don't retype.
  // Falls back to 'en' on any error — this page is reachable by logged-
  // out users too.
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t('help.title', locale)}</h1>
        <p className="text-gray-500 mt-1">{t('help.subtitle', locale)}</p>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="#faqs" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">{t('help.quickLink.faqs.title', locale)}</h3>
                <p className="text-sm text-gray-500">{t('help.quickLink.faqs.body', locale)}</p>
              </div>
            </a>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="#contact-form" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold">{t('help.quickLink.ask.title', locale)}</h3>
                <p className="text-sm text-gray-500">{t('help.quickLink.ask.body', locale)}</p>
              </div>
              <ExternalLink className="h-4 w-4 ml-auto text-gray-400" />
            </a>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="pt-6">
            <a href="mailto:support@penworth.ai" className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100">
                <Mail className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold">{t('help.quickLink.email.title', locale)}</h3>
                <p className="text-sm text-gray-500">support@penworth.ai</p>
              </div>
              <ExternalLink className="h-4 w-4 ml-auto text-gray-400" />
            </a>
          </CardContent>
        </Card>
      </div>

      {/* FAQs */}
      <div id="faqs" className="space-y-6 scroll-mt-6">
        <h2 className="text-2xl font-bold">{t('help.faqsHeader', locale)}</h2>

        {faqs.map((category) => (
          <Card key={category.category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <category.icon className="h-5 w-5 text-primary" />
                {category.category}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {category.questions.map((faq, idx) => {
                const key = `${category.category}-${idx}`;
                const isExpanded = expandedFaq === key;

                return (
                  <div key={key} className="border rounded-lg">
                    <button
                      onClick={() => setExpandedFaq(isExpanded ? null : key)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
                    >
                      <span className="font-medium">{faq.q}</span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 text-gray-600 whitespace-pre-wrap">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Contact Form */}
      <Card id="contact-form" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            {t('help.stillNeedHelpTitle', locale)}
          </CardTitle>
          <CardDescription>{t('help.stillNeedHelpSubtitle', locale)}</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="text-center py-8">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <MessageSquare className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{t('help.messageSent', locale)}</h3>
              <p className="text-gray-500">
                {t('help.messageSentBody', locale).replace('{email}', contactEmail)}
              </p>
              <Button
                variant="outline"
                className="mt-4"
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
                  <label className="text-sm font-medium">{t('help.nameLabel', locale)}</label>
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder={t('help.namePlaceholder', locale)}
                    required
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">{t('help.emailLabel', locale)}</label>
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
                <label className="text-sm font-medium">{t('help.messageLabel', locale)}</label>
                <Textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder={t('help.messagePlaceholder', locale)}
                  rows={4}
                  required
                  maxLength={5000}
                />
              </div>
              {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? t('help.sending', locale) : t('help.sendMessage', locale)}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
