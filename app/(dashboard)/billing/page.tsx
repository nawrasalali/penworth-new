'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Check, CreditCard, Zap } from 'lucide-react';
import { t, isSupportedLocale, type Locale } from '@/lib/i18n/strings';

interface Subscription {
  plan: 'free' | 'pro' | 'max';
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface UsageData {
  credits_used: number;
  credits_limit: number;
  credits_purchased: number;
  documents_this_month: number;
  documents_limit: number;
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      '1,000 credits for first month (1 document)',
      'AI writing assistance',
      'PDF export',
      'Publish to Amazon KDP',
      'Community support',
      'Top up credit packs anytime',
      'Account stays active forever',
    ],
    limitations: [
      '"Created with Penworth.ai" branding (removed when you top up)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 19,
    annualPrice: 190,
    popular: true,
    features: [
      '2,000 credits/month (2 documents)',
      'Enhanced AI writing',
      'PDF & DOCX export',
      'No Penworth branding',
      'All 8 industry prompts',
      'Sell on Marketplace',
      'Purchase credit add-ons',
      'Email support (48hr)',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    monthlyPrice: 49,
    annualPrice: 490,
    features: [
      '5,000 credits/month (5 documents)',
      'Premium AI writing',
      'PDF, DOCX & EPUB export',
      'All publishing platforms',
      'All prompts + custom',
      'Credit rollover (2,500 max)',
      'Priority support (24hr)',
    ],
  },
];

const CREDIT_PACKS = [
  { id: 'v2_credits_1000', name: 'Single', credits: 1000, price: 39, perDoc: '39.00' },
  { id: 'v2_credits_3000', name: 'Triple', credits: 3000, price: 99, perDoc: '33.00', savings: '15%' },
  { id: 'v2_credits_10000', name: 'Bulk', credits: 10000, price: 290, perDoc: '29.00', savings: '26%' },
];

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('annual');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>('en');

  const supabase = createClient();

  useEffect(() => {
    loadBillingData();
  }, [searchParams]);

  // Success banner — translated after locale is resolved from the profile.
  useEffect(() => {
    if (isLoading) return;
    if (searchParams.get('success') === 'true') {
      setSuccessMessage(t('billing.subActivated', locale));
    } else if (searchParams.get('credits') === 'success') {
      setSuccessMessage(t('billing.creditsAdded', locale));
    }
  }, [isLoading, locale, searchParams]);

  const loadBillingData = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // Load profile with plan info
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, credits_balance, credits_purchased, preferred_language')
      .eq('id', user.id)
      .single();

    const plan = (profile?.plan as 'free' | 'pro' | 'max') || 'free';
    const rawLang = (profile?.preferred_language || 'en').toLowerCase();
    setLocale(isSupportedLocale(rawLang) ? rawLang : 'en');

    // Get subscription status from org
    const { data: orgMember } = await supabase
      .from('org_members')
      .select('organizations(subscription_tier, stripe_subscription_id)')
      .eq('user_id', user.id)
      .single();

    const orgPlan = (orgMember?.organizations as any)?.subscription_tier;

    setSubscription({
      plan: orgPlan || plan,
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
    });

    // Get documents this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: docsThisMonth } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth.toISOString());

    // Get plan limits
    const planLimits = {
      free: { credits: 1000, docs: 1 },
      pro: { credits: 2000, docs: 2 },
      max: { credits: 5000, docs: 5 },
    };

    const limits = planLimits[plan] || planLimits.free;

    setUsage({
      credits_used: limits.credits - (profile?.credits_balance || 0),
      credits_limit: limits.credits,
      credits_purchased: profile?.credits_purchased || 0,
      documents_this_month: docsThisMonth || 0,
      documents_limit: limits.docs,
    });

    setIsLoading(false);
  };

  const handleUpgrade = async (planId: string) => {
    if (planId === 'free') return;

    setIsProcessing(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          planId,
          billingPeriod,
        }),
      });

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (error) {
      alert(t('billing.checkoutFailed', locale));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBuyCreditPack = async (packId: string) => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditPackId: packId }),
      });

      const { url, error } = await response.json();
      if (error) throw new Error(error);
      if (url) window.location.href = url;
    } catch (error) {
      alert(t('billing.checkoutFailed', locale));
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
      alert(t('billing.portalFailed', locale));
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

  const currentPlan = PLANS.find(p => p.id === subscription?.plan) || PLANS[0];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">{t('billing.title', locale)}</h1>

      {/* Success Message */}
      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          <Check className="inline w-5 h-5 mr-2" />
          {successMessage}
        </div>
      )}

      {/* Current Plan */}
      <div className="border rounded-lg p-6 mb-8 bg-card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-1">{t('billing.currentPlan', locale)}: {currentPlan.name}</h2>
            <p className="text-muted-foreground">
              {subscription?.plan === 'free' 
                ? t('billing.freeForever', locale)
                : `$${currentPlan.monthlyPrice}/month or $${currentPlan.annualPrice}/year`
              }
            </p>
            {subscription?.current_period_end && subscription.plan !== 'free' && (
              <p className="text-sm text-muted-foreground mt-2">
                {subscription.cancel_at_period_end 
                  ? `${t('billing.cancelsOn', locale)} ${new Date(subscription.current_period_end).toLocaleDateString()}`
                  : `${t('billing.renewsOn', locale)} ${new Date(subscription.current_period_end).toLocaleDateString()}`
                }
              </p>
            )}
          </div>
          {subscription?.plan !== 'free' && (
            <Button variant="outline" onClick={handleManageBilling} disabled={isProcessing}>
              <CreditCard className="w-4 h-4 mr-2" />
              {t('billing.manageBilling', locale)}
            </Button>
          )}
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="border rounded-lg p-4 bg-card mb-8">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('billing.creditsAvailable', locale)}</h3>
          <p className="text-2xl font-bold">
            {((usage.credits_limit - usage.credits_used) + usage.credits_purchased).toLocaleString()}
          </p>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (usage.credits_used / usage.credits_limit) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{usage.credits_used.toLocaleString()} / {usage.credits_limit.toLocaleString()} {t('billing.creditsUsed', locale)}</span>
            <span>{usage.documents_this_month} document{usage.documents_this_month !== 1 ? 's' : ''} written</span>
          </div>
          {usage.credits_purchased > 0 && (
            <p className="text-xs text-green-600 mt-1">
              + {usage.credits_purchased.toLocaleString()} {t('billing.credits', locale).toLowerCase()}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
            {t('billing.oneDocEqualsCredits', locale)}
          </p>
        </div>
      )}

      {/* Plans */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('billing.availablePlans', locale)}</h2>
        <div className="inline-flex items-center gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setBillingPeriod('monthly')}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              billingPeriod === 'monthly' ? 'bg-background shadow' : ''
            }`}
          >
            {t('billing.monthly', locale)}
          </button>
          <button
            onClick={() => setBillingPeriod('annual')}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              billingPeriod === 'annual' ? 'bg-background shadow' : ''
            }`}
          >
            {t('billing.annual', locale)}
            <span className="ml-1 text-xs text-green-600">{t('billing.save17', locale)}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3 mb-12">
        {PLANS.map((plan) => (
          <div 
            key={plan.id}
            className={`border rounded-lg p-6 relative ${
              plan.popular ? 'border-primary ring-2 ring-primary/20' : ''
            } ${subscription?.plan === plan.id ? 'bg-primary/5' : 'bg-card'}`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-medium">
                Most Popular
              </span>
            )}

            <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
            <div className="mb-4">
              {plan.monthlyPrice === 0 ? (
                <span className="text-2xl font-bold">Free</span>
              ) : (
                <>
                  <span className="text-3xl font-bold">
                    ${billingPeriod === 'annual' ? plan.annualPrice : plan.monthlyPrice}
                  </span>
                  <span className="text-muted-foreground">
                    /{billingPeriod === 'annual' ? 'year' : 'mo'}
                  </span>
                </>
              )}
            </div>

            <ul className="space-y-2 mb-6">
              {plan.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
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

            {subscription?.plan === plan.id ? (
              <Button variant="outline" className="w-full" disabled>
                {t('billing.currentPlan', locale)}
              </Button>
            ) : (
              <Button 
                className="w-full"
                variant={plan.popular ? 'default' : 'outline'}
                onClick={() => handleUpgrade(plan.id)}
                disabled={isProcessing || plan.monthlyPrice === 0}
              >
                {plan.monthlyPrice === 0 ? t('billing.downgrade', locale) : t('billing.upgrade', locale)}
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Credit Packs */}
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h2 className="text-xl font-semibold">{t('billing.creditPacksTitle', locale)}</h2>
        </div>
        <p className="text-muted-foreground mb-2">
          {t('billing.creditPacksBody', locale)}
        </p>
        {subscription?.plan === 'free' && (
          <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">
            ✨ {t('billing.freeWatermarkRemoved', locale)}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => {
            // Pack name: translate by id, fall back to English if unknown
            const packNameKey =
              pack.id === 'v2_credits_1000' ? 'billing.creditPackSingle' :
              pack.id === 'v2_credits_3000' ? 'billing.creditPackTriple' :
              pack.id === 'v2_credits_10000' ? 'billing.creditPackBulk' : null;
            const packName = packNameKey ? t(packNameKey, locale) : pack.name;
            return (
            <div key={pack.id} className="border rounded-lg p-6 bg-card">
              <h3 className="font-semibold mb-1">{packName}</h3>
              <p className="text-3xl font-bold mb-1">${pack.price}</p>
              <p className="text-sm text-muted-foreground mb-3">
                {pack.credits.toLocaleString()} {t('billing.credits', locale).toLowerCase()}
              </p>
              <p className="text-sm mb-4">
                ${pack.perDoc}/{t('billing.perDoc', locale)}
                {pack.savings && (
                  <span className="ml-2 text-green-600 font-medium">({pack.savings})</span>
                )}
              </p>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => handleBuyCreditPack(pack.id)}
                disabled={isProcessing}
              >
                {t('billing.buyCredits', locale)}
              </Button>
            </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground mt-4">
          Purchased credits never expire • Used after monthly credits are exhausted
        </p>
      </div>

      {/* Enterprise CTA */}
      <div className="border rounded-lg p-6 bg-muted/30 text-center">
        <h3 className="font-semibold mb-2">Publishing 50+ documents a month?</h3>
        <p className="text-muted-foreground mb-4">
          Get volume pricing, SSO, API access, and dedicated support.
        </p>
        <Button variant="outline" asChild>
          <a href="mailto:enterprise@penworth.ai">Contact Sales</a>
        </Button>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 space-y-8 p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/4 mb-8"></div>
          <div className="h-64 bg-muted rounded mb-8"></div>
          <div className="h-48 bg-muted rounded"></div>
        </div>
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}
