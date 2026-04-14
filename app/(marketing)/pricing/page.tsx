'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: 0, annual: 0 },
    description: 'Perfect for getting started',
    features: [
      '3 projects',
      '10,000 words/month',
      'Basic AI assistant (Haiku)',
      'Community support',
      'Web-based editor',
    ],
    limitations: [
      'No PDF/DOCX export',
      'Watermarked output',
      'No team collaboration',
    ],
    cta: 'Start Free',
    ctaLink: '/signup',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { monthly: 29, annual: 290 },
    description: 'For serious writers and researchers',
    popular: true,
    features: [
      'Unlimited projects',
      '100,000 words/month',
      'Advanced AI (Sonnet)',
      'Export to PDF & DOCX',
      'No watermarks',
      'Priority support',
      'Version history',
      '8 industry-specific agents',
      'Citation management',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/signup?plan=pro',
  },
  {
    id: 'team',
    name: 'Team',
    price: { monthly: 49, annual: 490 },
    perUser: true,
    description: 'Collaborate with your team',
    features: [
      'Everything in Pro',
      'Up to 10 team members',
      'Team workspace',
      'Real-time collaboration',
      'Admin controls',
      'Usage analytics',
      'Shared templates',
      'Comment & review workflow',
    ],
    cta: 'Start Free Trial',
    ctaLink: '/signup?plan=team',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: { monthly: null, annual: null },
    description: 'For large organizations',
    features: [
      'Everything in Team',
      'Unlimited team members',
      'SSO/SAML authentication',
      'Custom AI model training',
      'Dedicated account manager',
      'SLA guarantee (99.9%)',
      'On-premise deployment option',
      'Custom integrations',
      'Compliance (SOC 2, HIPAA)',
      'Priority 24/7 support',
    ],
    cta: 'Contact Sales',
    ctaLink: 'mailto:sales@penworth.ai',
  },
];

const FEATURE_COMPARISON = [
  { feature: 'Projects', free: '3', pro: 'Unlimited', team: 'Unlimited', enterprise: 'Unlimited' },
  { feature: 'Words/month', free: '10K', pro: '100K', team: '500K', enterprise: 'Unlimited' },
  { feature: 'AI Model', free: 'Haiku', pro: 'Sonnet', team: 'Sonnet', enterprise: 'Opus + Custom' },
  { feature: 'Export formats', free: 'None', pro: 'PDF, DOCX', team: 'PDF, DOCX, EPUB', enterprise: 'All + Custom' },
  { feature: 'Team members', free: '1', pro: '1', team: '10', enterprise: 'Unlimited' },
  { feature: 'Version history', free: '—', pro: '30 days', team: '90 days', enterprise: 'Unlimited' },
  { feature: 'Support', free: 'Community', pro: 'Priority', team: 'Priority', enterprise: 'Dedicated' },
  { feature: 'SSO/SAML', free: '—', pro: '—', team: '—', enterprise: '✓' },
  { feature: 'Analytics', free: '—', pro: 'Basic', team: 'Advanced', enterprise: 'Custom' },
  { feature: 'API access', free: '—', pro: '—', team: '✓', enterprise: '✓' },
  { feature: 'Custom branding', free: '—', pro: '—', team: '✓', enterprise: '✓' },
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
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
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
                  <th className="text-left px-6 py-4 font-semibold">Feature</th>
                  <th className="text-center px-6 py-4 font-semibold">Free</th>
                  <th className="text-center px-6 py-4 font-semibold">Pro</th>
                  <th className="text-center px-6 py-4 font-semibold">Team</th>
                  <th className="text-center px-6 py-4 font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {FEATURE_COMPARISON.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-muted/20' : ''}>
                    <td className="px-6 py-3 font-medium">{row.feature}</td>
                    <td className="text-center px-6 py-3">{row.free}</td>
                    <td className="text-center px-6 py-3">{row.pro}</td>
                    <td className="text-center px-6 py-3">{row.team}</td>
                    <td className="text-center px-6 py-3">{row.enterprise}</td>
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
