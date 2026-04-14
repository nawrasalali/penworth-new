'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

interface Subscription {
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface UsageData {
  words_used: number;
  words_limit: number;
  projects_used: number;
  projects_limit: number;
  ai_tokens_used: number;
  ai_tokens_limit: number;
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: [
      '3 projects',
      '10,000 words/month',
      'Basic AI (Haiku)',
      'Community support',
    ],
    limitations: [
      'No export to PDF/DOCX',
      'No team collaboration',
      'Watermarked exports',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29,
    popular: true,
    features: [
      'Unlimited projects',
      '100,000 words/month',
      'Advanced AI (Sonnet)',
      'Export to PDF & DOCX',
      'Priority support',
      'No watermarks',
      'Version history',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: 49,
    perUser: true,
    features: [
      'Everything in Pro',
      'Team workspaces',
      'Up to 10 members',
      'Collaboration tools',
      'Admin controls',
      'Usage analytics',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    features: [
      'Everything in Team',
      'Unlimited members',
      'SSO/SAML',
      'Custom integrations',
      'Dedicated support',
      'SLA guarantee',
      'On-premise option',
      'Custom AI training',
    ],
  },
];

export default function BillingPage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // Load subscription from organizations (user might have personal or org subscription)
    const { data: orgData } = await supabase
      .from('organizations')
      .select('subscription_tier, stripe_subscription_id')
      .limit(1)
      .single();

    if (orgData) {
      setSubscription({
        tier: orgData.subscription_tier as any || 'free',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
      });
    } else {
      setSubscription({
        tier: 'free',
        status: 'active',
        current_period_end: '',
        cancel_at_period_end: false,
      });
    }

    // Calculate usage
    const { data: projects } = await supabase
      .from('projects')
      .select('id, chapters(word_count)')
      .eq('user_id', user.id);

    const totalWords = projects?.reduce((sum, p) => 
      sum + (p.chapters?.reduce((s: number, c: any) => s + (c.word_count || 0), 0) || 0), 0
    ) || 0;

    setUsage({
      words_used: totalWords,
      words_limit: subscription?.tier === 'pro' ? 100000 : subscription?.tier === 'team' ? 500000 : 10000,
      projects_used: projects?.length || 0,
      projects_limit: subscription?.tier === 'free' ? 3 : -1,
      ai_tokens_used: 0,
      ai_tokens_limit: subscription?.tier === 'free' ? 50000 : -1,
    });

    setIsLoading(false);
  };

  const handleUpgrade = async (planId: string) => {
    if (planId === 'enterprise') {
      window.open('mailto:sales@penworth.ai?subject=Enterprise%20Inquiry', '_blank');
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (error) {
      alert('Failed to start checkout. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManageBilling = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
      });

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (error) {
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const currentPlan = PLANS.find(p => p.id === subscription?.tier) || PLANS[0];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Billing & Subscription</h1>

      {/* Current Plan */}
      <div className="border rounded-lg p-6 mb-8 bg-card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-1">Current Plan: {currentPlan.name}</h2>
            <p className="text-muted-foreground">
              {subscription?.tier === 'free' 
                ? 'Free forever' 
                : `$${currentPlan.price}${currentPlan.perUser ? '/user' : ''}/month`
              }
            </p>
            {subscription?.current_period_end && subscription.tier !== 'free' && (
              <p className="text-sm text-muted-foreground mt-2">
                {subscription.cancel_at_period_end 
                  ? `Cancels on ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : `Renews on ${new Date(subscription.current_period_end).toLocaleDateString()}`
                }
              </p>
            )}
          </div>
          {subscription?.tier !== 'free' && (
            <Button variant="outline" onClick={handleManageBilling} disabled={isProcessing}>
              Manage Billing
            </Button>
          )}
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Words This Month</h3>
            <p className="text-2xl font-bold">{usage.words_used.toLocaleString()}</p>
            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (usage.words_used / usage.words_limit) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              of {usage.words_limit === -1 ? 'unlimited' : usage.words_limit.toLocaleString()}
            </p>
          </div>

          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Projects</h3>
            <p className="text-2xl font-bold">{usage.projects_used}</p>
            {usage.projects_limit !== -1 && (
              <>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(usage.projects_used / usage.projects_limit) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  of {usage.projects_limit} max
                </p>
              </>
            )}
            {usage.projects_limit === -1 && (
              <p className="text-xs text-muted-foreground mt-2">Unlimited</p>
            )}
          </div>

          <div className="border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">AI Tokens</h3>
            <p className="text-2xl font-bold">{usage.ai_tokens_used.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {usage.ai_tokens_limit === -1 ? 'Unlimited' : `of ${usage.ai_tokens_limit.toLocaleString()}`}
            </p>
          </div>
        </div>
      )}

      {/* Plans */}
      <h2 className="text-xl font-semibold mb-4">Available Plans</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <div 
            key={plan.id}
            className={`border rounded-lg p-6 relative ${
              plan.popular ? 'border-primary ring-2 ring-primary/20' : ''
            } ${subscription?.tier === plan.id ? 'bg-primary/5' : 'bg-card'}`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-medium">
                Most Popular
              </span>
            )}

            <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
            <div className="mb-4">
              {plan.price === null ? (
                <span className="text-2xl font-bold">Custom</span>
              ) : plan.price === 0 ? (
                <span className="text-2xl font-bold">Free</span>
              ) : (
                <>
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-muted-foreground">/{plan.perUser ? 'user/' : ''}mo</span>
                </>
              )}
            </div>

            <ul className="space-y-2 mb-6">
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

            {subscription?.tier === plan.id ? (
              <Button variant="outline" className="w-full" disabled>
                Current Plan
              </Button>
            ) : (
              <Button 
                className="w-full"
                variant={plan.popular ? 'default' : 'outline'}
                onClick={() => handleUpgrade(plan.id)}
                disabled={isProcessing}
              >
                {plan.price === null ? 'Contact Sales' : plan.price === 0 ? 'Downgrade' : 'Upgrade'}
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div className="mt-12">
        <h2 className="text-xl font-semibold mb-4">Frequently Asked Questions</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-medium mb-2">Can I change plans anytime?</h3>
            <p className="text-sm text-muted-foreground">
              Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate your billing accordingly.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-medium mb-2">What payment methods do you accept?</h3>
            <p className="text-sm text-muted-foreground">
              We accept all major credit cards (Visa, MasterCard, Amex), PayPal, and USDT (ERC-20) for annual plans.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-medium mb-2">Is there a free trial?</h3>
            <p className="text-sm text-muted-foreground">
              Yes! Pro and Team plans include a 14-day free trial. No credit card required to start.
            </p>
          </div>
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-medium mb-2">What happens if I exceed my limits?</h3>
            <p className="text-sm text-muted-foreground">
              We'll notify you before you hit your limits. You can upgrade anytime or purchase additional capacity as needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
