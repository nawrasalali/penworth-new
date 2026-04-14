'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: 0, annual: 0 },
    description: 'Try AI book writing',
    features: [
      '1 book project',
      'AI-powered writing',
      'Basic formatting',
      'Community support',
    ],
    limitations: [
      '"Written with Penworth" branding',
      'No PDF/DOCX export',
      'No publishing connectors',
    ],
    cta: 'Start Free',
    ctaLink: '/signup',
  },
  {
    id: 'starter',
    name: 'Starter',
    price: { monthly: 29, annual: 232 },
    description: 'For first-time authors',
    features: [
      '1 book per month',
      'AI-powered writing (Sonnet)',
      'PDF & DOCX export',
      'No watermarks',
      'Email support',
      'Basic cover design',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/signup?plan=starter',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { monthly: 59, annual: 472 },
    description: 'For serious authors',
    popular: true,
    features: [
      '3 books per month',
      'Everything in Starter',
      'Priority AI processing',
      '8 industry-specific agents',
      'Advanced cover design',
      'Amazon KDP connector',
      'Priority support',
      'Version history',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/signup?plan=pro',
  },
  {
    id: 'publisher',
    name: 'Publisher',
    price: { monthly: 149, annual: 1192 },
    description: 'For power publishers',
    features: [
      '10 books per month',
      'Everything in Pro',
      'All 16 publishing connectors',
      'White-label exports',
      'Bulk publishing tools',
      'Analytics dashboard',
      'Team collaboration (3 seats)',
      'Dedicated support',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/signup?plan=publisher',
  },
  {
    id: 'agency',
    name: 'Agency',
    price: { monthly: 349, annual: 2792 },
    description: 'For agencies & enterprises',
    features: [
      'Unlimited books',
      'Everything in Publisher',
      'Unlimited team seats',
      'API access',
      'Custom branding',
      'SSO/SAML authentication',
      'Dedicated account manager',
      'SLA guarantee (99.9%)',
      'Custom integrations',
    ],
    cta: 'Contact Sales',
    ctaLink: 'mailto:sales@penworth.ai',
  },
];

const FEATURE_COMPARISON = [
  { feature: 'Books/month', free: '1', starter: '1', pro: '3', publisher: '10', agency: 'Unlimited' },
  { feature: 'AI Model', free: 'Haiku', starter: 'Sonnet', pro: 'Sonnet', publisher: 'Sonnet', agency: 'Opus' },
  { feature: 'Export formats', free: 'None', starter: 'PDF, DOCX', pro: 'PDF, DOCX', publisher: 'All', agency: 'All + Custom' },
  { feature: 'Publishing connectors', free: '—', starter: '—', pro: 'KDP', publisher: 'All 16', agency: 'All 16 + API' },
  { feature: 'Team seats', free: '1', starter: '1', pro: '1', publisher: '3', agency: 'Unlimited' },
  { feature: 'Cover design', free: '—', starter: 'Basic', pro: 'Advanced', publisher: 'Advanced', agency: 'Custom' },
  { feature: 'Support', free: 'Community', starter: 'Email', pro: 'Priority', publisher: 'Dedicated', agency: 'Account Manager' },
  { feature: 'Branding', free: 'Penworth', starter: 'Clean', pro: 'Clean', publisher: 'White-label', agency: 'Custom' },
  { feature: 'Analytics', free: '—', starter: '—', pro: 'Basic', publisher: 'Advanced', agency: 'Custom' },
  { feature: 'API access', free: '—', starter: '—', pro: '—', publisher: '—', agency: '✓' },
  { feature: 'SSO/SAML', free: '—', starter: '—', pro: '—', publisher: '—', agency: '✓' },
];

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  const [showComparison, setShowComparison] = useState(false);

  const getPrice = (plan: typeof PLANS[0]) => {
    if (plan.price.monthly === null) return 'Custom';
    if (plan.price.monthly === 0) return 'Free';
    const price = billingPeriod === 'annual' ? plan.price.annual : plan.price.monthly;
    return `$${price}`;
  };

  const getSavings = (plan: typeof PLANS[0]) => {
    if (plan.price.monthly === null || plan.price.monthly === 0) return null;
    const monthlyTotal = plan.price.monthly * 12;
    const annualTotal = plan.price.annual;
    const savings = monthlyTotal - annualTotal;
    return savings > 0 ? `Save $${savings}/year` : null;
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
          Start free and scale as you grow. All plans include a 14-day free trial.
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
      <section className="max-w-7xl mx-auto px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
                {plan.price.monthly !== null && plan.price.monthly > 0 && (
                  <span className="text-muted-foreground">
                    /{plan.perUser ? 'user/' : ''}{billingPeriod === 'annual' ? 'year' : 'mo'}
                  </span>
                )}
                {billingPeriod === 'annual' && getSavings(plan) && (
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
                    <span className="text-green-500 mt-0.5">✓</span>
                    {feature}
                  </li>
                ))}
                {plan.limitations?.map((limitation, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-0.5">✗</span>
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="max-w-7xl mx-auto px-6 pb-16">
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
                  <th className="text-left px-4 py-4 font-semibold">Feature</th>
                  <th className="text-center px-4 py-4 font-semibold">Free</th>
                  <th className="text-center px-4 py-4 font-semibold">Starter</th>
                  <th className="text-center px-4 py-4 font-semibold">Pro</th>
                  <th className="text-center px-4 py-4 font-semibold">Publisher</th>
                  <th className="text-center px-4 py-4 font-semibold">Agency</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_COMPARISON.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-muted/20' : ''}>
                    <td className="px-4 py-3 font-medium">{row.feature}</td>
                    <td className="text-center px-4 py-3">{row.free}</td>
                    <td className="text-center px-4 py-3">{row.starter}</td>
                    <td className="text-center px-4 py-3">{row.pro}</td>
                    <td className="text-center px-4 py-3">{row.publisher}</td>
                    <td className="text-center px-4 py-3">{row.agency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* FAQ */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {[
            {
              q: 'Can I try before I buy?',
              a: 'Yes! All paid plans include a 14-day free trial with full access to all features. No credit card required to start.',
            },
            {
              q: 'Can I change plans later?',
              a: 'Absolutely. You can upgrade, downgrade, or cancel at any time. Changes take effect immediately and billing is prorated.',
            },
            {
              q: 'What payment methods do you accept?',
              a: 'We accept all major credit cards (Visa, MasterCard, Amex), PayPal, and cryptocurrency (USDT) for annual plans.',
            },
            {
              q: 'Do you offer discounts for startups or education?',
              a: 'Yes! We offer 50% off for verified startups, students, and educational institutions. Contact us to apply.',
            },
            {
              q: 'What happens when I hit my word limit?',
              a: "We'll notify you when you're approaching your limit. You can upgrade anytime or purchase additional capacity without changing plans.",
            },
            {
              q: 'Is my data secure?',
              a: 'Absolutely. We use bank-level encryption, are SOC 2 compliant (Enterprise), and never train AI on your data without explicit consent.',
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
        <h2 className="text-3xl font-bold mb-4">Ready to transform your writing?</h2>
        <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
          Join thousands of writers, researchers, and teams using Penworth to create better content faster.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/signup">
            <Button size="lg" variant="secondary">
              Start Free Trial
            </Button>
          </Link>
          <Link href="mailto:sales@penworth.ai">
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
