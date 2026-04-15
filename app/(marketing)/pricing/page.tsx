'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: 0, annual: 0 },
    description: 'Start writing and publishing',
    features: [
      { text: '1,000 credits/month (1 document)', included: true },
      { text: 'AI writing assistance (Varies)', included: true },
      { text: 'PDF export', included: true },
      { text: 'Publish to Amazon KDP', included: true },
      { text: 'General industry prompt', included: true },
      { text: 'Community support', included: true },
    ],
    limitations: [
      '"Created with Penworth.ai" branding',
      'Cannot purchase credit packs',
      'Credits expire monthly',
    ],
    cta: 'Get Started',
    ctaLink: '/signup',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { monthly: 19, annual: 190 },
    description: 'Better AI quality + more output',
    popular: true,
    features: [
      { text: '2,000 credits/month (2 documents)', included: true },
      { text: 'Enhanced AI writing (Varies)', included: true },
      { text: 'PDF & DOCX export', included: true },
      { text: 'No Penworth branding', included: true },
      { text: 'Publish to Amazon KDP', included: true },
      { text: 'All 8 industry prompts', included: true },
      { text: 'Sell on Marketplace (15% fee)', included: true },
      { text: 'Purchase credit add-ons', included: true },
      { text: 'Email support (48hr)', included: true },
    ],
    cta: 'Upgrade to Pro',
    ctaLink: '/signup?plan=pro',
  },
  {
    id: 'max',
    name: 'Max',
    price: { monthly: 49, annual: 490 },
    description: 'Full platform access',
    features: [
      { text: '5,000 credits/month (5 documents)', included: true },
      { text: 'Premium AI writing (Varies)', included: true },
      { text: 'PDF, DOCX & EPUB export', included: true },
      { text: 'No Penworth branding', included: true },
      { text: 'All publishing platforms', included: true },
      { text: 'All 8 industry prompts + custom', included: true },
      { text: 'Sell on Marketplace (15% fee)', included: true },
      { text: 'Purchase credit add-ons', included: true },
      { text: 'Credit rollover (up to 2,500)', included: true },
      { text: 'Priority email support (24hr)', included: true },
    ],
    cta: 'Upgrade to Max',
    ctaLink: '/signup?plan=max',
  },
];

const FEATURE_COMPARISON = [
  { feature: 'Monthly credits', free: '1,000 (1 doc)', pro: '2,000 (2 docs)', max: '5,000 (5 docs)' },
  { feature: 'AI writing quality', free: 'Varies', pro: 'Varies', max: 'Varies' },
  { feature: 'Export formats', free: 'PDF', pro: 'PDF, DOCX', max: 'PDF, DOCX, EPUB' },
  { feature: 'Penworth branding', free: 'Yes', pro: 'No', max: 'No' },
  { feature: 'Amazon KDP publishing', free: '✓', pro: '✓', max: '✓' },
  { feature: 'All publishing platforms', free: '—', pro: '—', max: '✓' },
  { feature: 'Industry prompts', free: 'General', pro: 'All 8', max: 'All 8 + Custom' },
  { feature: 'Marketplace selling', free: '—', pro: '✓ (15% fee)', max: '✓ (15% fee)' },
  { feature: 'Credit add-on packs', free: '—', pro: '✓', max: '✓' },
  { feature: 'Credit rollover', free: '—', pro: '—', max: 'Up to 2,500' },
  { feature: 'Support', free: 'Community', pro: 'Email (48hr)', max: 'Priority (24hr)' },
];

const CREDIT_PACKS = [
  { name: 'Single', credits: 1000, price: 39, perBook: '39.00', savings: null },
  { name: 'Triple', credits: 3000, price: 99, perBook: '33.00', savings: '15%' },
  { name: 'Bulk', credits: 10000, price: 290, perBook: '29.00', savings: '26%' },
];

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  const [showComparison, setShowComparison] = useState(false);

  const getPrice = (plan: typeof PLANS[0]) => {
    if (plan.price.monthly === 0) return 'Free';
    const price = billingPeriod === 'annual' ? plan.price.annual : plan.price.monthly;
    return `\$${price}`;
  };

  const getSavings = (plan: typeof PLANS[0]) => {
    if (plan.price.monthly === 0) return null;
    if (billingPeriod === 'annual') {
      const monthlyTotal = plan.price.monthly * 12;
      const annualTotal = plan.price.annual;
      const percent = Math.round(((monthlyTotal - annualTotal) / monthlyTotal) * 100);
      return `Save ${percent}%`;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-primary">
            Penworth
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm hover:text-primary">
              Sign In
            </Link>
            <Link href="/signup">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Start free. Upgrade when you need more.
        </p>

        {/* Billing Toggle */}
        <div className="inline-flex items-center gap-3 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setBillingPeriod('monthly')}
            className={`px-4 py-2 rounded-md transition-colors ${
              billingPeriod === 'monthly' ? 'bg-background shadow' : ''
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingPeriod('annual')}
            className={`px-4 py-2 rounded-md transition-colors ${
              billingPeriod === 'annual' ? 'bg-background shadow' : ''
            }`}
          >
            Annual
            <span className="ml-2 text-xs text-green-600 font-medium">Save 17%</span>
          </button>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="max-w-5xl mx-auto px-6 pb-8">
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`border rounded-2xl p-6 bg-card relative ${
                plan.popular ? 'border-primary ring-2 ring-primary/20' : ''
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </span>
              )}

              <h3 className="text-xl font-semibold mb-1">{plan.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>

              <div className="mb-6">
                <span className="text-4xl font-bold">{getPrice(plan)}</span>
                {plan.price.monthly > 0 && (
                  <span className="text-muted-foreground">
                    /{billingPeriod === 'annual' ? 'year' : 'mo'}
                  </span>
                )}
                {getSavings(plan) && (
                  <p className="text-sm text-green-600 font-medium mt-1">{getSavings(plan)}</p>
                )}
              </div>

              <Link href={plan.ctaLink}>
                <Button
                  className="w-full mb-6"
                  variant={plan.popular ? 'default' : 'outline'}
                >
                  {plan.cta}
                </Button>
              </Link>

              <ul className="space-y-3">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {feature.text}
                  </li>
                ))}
                {plan.limitations?.map((limitation, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <X className="w-4 h-4 mt-0.5 shrink-0" />
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="text-center py-4 border rounded-lg bg-muted/30">
          <p className="text-muted-foreground">
            Publishing 50+ documents a month?{' '}
            <Link href="mailto:enterprise@penworth.ai" className="text-primary hover:underline font-medium">
              Contact us →
            </Link>
          </p>
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="text-center mb-8">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="text-primary hover:underline"
          >
            {showComparison ? 'Hide' : 'Show'} full feature comparison
          </button>
        </div>

        {showComparison && (
          <div className="border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-6 py-4 font-semibold">Feature</th>
                  <th className="text-center px-6 py-4 font-semibold">Free</th>
                  <th className="text-center px-6 py-4 font-semibold">Pro</th>
                  <th className="text-center px-6 py-4 font-semibold">Max</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_COMPARISON.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-muted/20' : ''}>
                    <td className="px-6 py-3 font-medium">{row.feature}</td>
                    <td className="text-center px-6 py-3">{row.free}</td>
                    <td className="text-center px-6 py-3">{row.pro}</td>
                    <td className="text-center px-6 py-3">{row.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Credit Add-On Packs */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold mb-2">Need more? Add credits anytime.</h2>
          <p className="text-muted-foreground">Available for Pro and Max subscribers</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.name} className="border rounded-xl p-6 bg-card text-center">
              <h3 className="font-semibold mb-1">{pack.name}</h3>
              <p className="text-3xl font-bold mb-1">\${pack.price}</p>
              <p className="text-sm text-muted-foreground mb-3">
                {pack.credits.toLocaleString()} credits
              </p>
              <p className="text-sm">
                \${pack.perBook}/document
                {pack.savings && (
                  <span className="ml-2 text-green-600 font-medium">({pack.savings} off)</span>
                )}
              </p>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Purchased credits never expire • Used after monthly credits
        </p>
      </section>

      {/* FAQ */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {[
            {
              q: 'Can free users really publish?',
              a: 'Yes! Free users can publish to Amazon KDP. Your book will include "Created with Penworth.ai" branding, which helps us grow while you get a real published book.',
            },
            {
              q: 'What happens to unused credits?',
              a: 'Monthly subscription credits expire at the end of each billing cycle. However, purchased credit packs never expire and are used after your monthly credits are exhausted.',
            },
            {
              q: 'Can I upgrade or downgrade anytime?',
              a: 'Absolutely. You can change plans at any time. Upgrades take effect immediately, and downgrades apply at the end of your billing cycle.',
            },
            {
              q: 'What payment methods do you accept?',
              a: 'We accept all major credit cards through Stripe. Annual plans can also be paid via PayPal or cryptocurrency (USDT).',
            },
            {
              q: 'What is a credit?',
              a: 'Credits power your document generation. 1,000 credits = 1 standard document. Pro and Max subscribers can purchase additional credit packs when needed.',
            },
            {
              q: 'What about teams?',
              a: 'Multi-user workspaces are available for Enterprise customers. Contact us to discuss team pricing and features like SSO, API access, and dedicated support.',
            },
          ].map((faq, i) => (
            <div key={i} className="border rounded-lg p-5 bg-card">
              <h3 className="font-semibold mb-2">{faq.q}</h3>
              <p className="text-sm text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary text-primary-foreground py-16 px-6 text-center">
        <h2 className="text-3xl font-bold mb-4">Ready to write your book?</h2>
        <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
          Join thousands of authors using Penworth to write and publish books faster than ever.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/signup">
            <Button size="lg" variant="secondary">
              Start Free
            </Button>
          </Link>
          <Link href="mailto:enterprise@penworth.ai">
            <Button size="lg" variant="outline" className="bg-transparent border-white/30 hover:bg-white/10">
              Contact Sales
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 Penworth. A product of A.C.N. 675 668 710 PTY LTD.
          </p>
          <div className="flex gap-6 text-sm">
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
            <Link href="/terms" className="hover:text-primary">Terms</Link>
            <Link href="mailto:support@penworth.ai" className="hover:text-primary">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
