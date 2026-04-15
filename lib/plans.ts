// Penworth v2 Plan Configuration
// DO NOT MODIFY - This follows the exact v2 pricing specification
// IMPORTANT: 1000 credits = 1 document. Credits ARE the document limit.

export type PublishingConnector = 'kdp' | 'ingram_spark' | 'd2d' | 'lulu' | 'google_play';

export const CREDIT_COSTS = {
  standardDocument: 1_000, // 1 document costs 1000 credits
} as const;

export const PLAN_LIMITS: Record<string, {
  monthlyCredits: number;
  // Document limit = monthlyCredits / CREDIT_COSTS.standardDocument
  // Free: 1000 credits = 1 doc, Pro: 2000 = 2 docs, Max: 5000 = 5 docs
  models: string[];
  exportFormats: string[];
  hasBranding: boolean;
  publishingConnectors: PublishingConnector[];
  industryPrompts: string | string[];
  marketplaceSell: boolean;
  marketplaceCommission?: number;
  creditRollover?: number;
  creditRolloverMax: number;
  canBuyCredits: boolean;
  supportLevel: string;
}> = {
  free: {
    monthlyCredits: 1_000, // = 1 document/month
    models: ['claude-haiku-4.5'],
    exportFormats: ['pdf'],
    hasBranding: true,
    publishingConnectors: ['kdp'],
    industryPrompts: ['general'],
    marketplaceSell: false,
    creditRolloverMax: 0,
    canBuyCredits: false,
    supportLevel: 'community',
  },
  pro: {
    monthlyCredits: 2_000, // = 2 documents/month
    models: ['claude-haiku-4.5', 'claude-sonnet-4.6'],
    exportFormats: ['pdf', 'docx'],
    hasBranding: false,
    publishingConnectors: ['kdp'],
    industryPrompts: 'all',
    marketplaceSell: true,
    marketplaceCommission: 0.15,
    creditRolloverMax: 0,
    canBuyCredits: true,
    supportLevel: 'email',
  },
  max: {
    monthlyCredits: 5_000, // = 5 documents/month
    models: ['claude-haiku-4.5', 'claude-sonnet-4.6', 'claude-opus-4.6'],
    exportFormats: ['pdf', 'docx', 'epub'],
    hasBranding: false,
    publishingConnectors: ['kdp', 'ingram_spark', 'd2d', 'lulu', 'google_play'],
    industryPrompts: 'all_plus_custom',
    marketplaceSell: true,
    marketplaceCommission: 0.15,
    creditRollover: 2_500,
    creditRolloverMax: 2_500,
    canBuyCredits: true,
    supportLevel: 'priority_email',
  },
};

// Helper to calculate document limit from credits
export function getDocumentLimit(plan: string): number {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  return Math.floor(limits.monthlyCredits / CREDIT_COSTS.standardDocument);
}

export const CREDIT_PACKS = [
  { id: 'v2_credits_1000', name: 'Single', credits: 1_000, price: 39, priceInCents: 3_900 },
  { id: 'v2_credits_3000', name: 'Triple', credits: 3_000, price: 99, priceInCents: 9_900 },
  { id: 'v2_credits_10000', name: 'Bulk', credits: 10_000, price: 290, priceInCents: 29_000 },
] as const;

export const STRIPE_PRODUCTS = {
  // Subscription products - v2 pricing
  v2_pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_1TM8vSDAwDFDea8Lx2HRVsvb',
  v2_pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL || 'price_1TM8yKDAwDFDea8Lia58tjN2',
  v2_max_monthly: process.env.STRIPE_PRICE_MAX_MONTHLY || 'price_1TM8xADAwDFDea8Ld0hDB5mO',
  v2_max_annual: process.env.STRIPE_PRICE_MAX_ANNUAL || 'price_1TM8zQDAwDFDea8LyLGIX1Ek',
  // Credit packs
  v2_credits_1000: process.env.STRIPE_PRICE_CREDITS_1000 || 'price_1TM90DDAwDFDea8LXyYMDoYU',
  v2_credits_3000: process.env.STRIPE_PRICE_CREDITS_3000 || 'price_1TM91IDAwDFDea8LFYWHxO1C',
  v2_credits_10000: process.env.STRIPE_PRICE_CREDITS_10000 || 'price_1TM91zDAwDFDea8LlLpGQetJ',
} as const;

export type PlanId = 'free' | 'pro' | 'max';
export type CreditPackId = typeof CREDIT_PACKS[number]['id'];
