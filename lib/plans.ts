// Penworth v2 Plan Configuration
// DO NOT MODIFY - This follows the exact v2 pricing specification

export const PLAN_LIMITS = {
  free: {
    monthlyCredits: 1_000,
    maxDocuments: 1,
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
    monthlyCredits: 2_000,
    maxDocuments: 2,
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
    monthlyCredits: 5_000,
    maxDocuments: 5,
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
} as const;

export const CREDIT_COSTS = {
  standardDocument: 1_000,
} as const;

export const CREDIT_PACKS = [
  { id: 'v2_credits_1000', name: 'Single', credits: 1_000, price: 39, priceInCents: 3_900 },
  { id: 'v2_credits_3000', name: 'Triple', credits: 3_000, price: 99, priceInCents: 9_900 },
  { id: 'v2_credits_10000', name: 'Bulk', credits: 10_000, price: 290, priceInCents: 29_000 },
] as const;

export const STRIPE_PRODUCTS = {
  // Subscription products
  v2_pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
  v2_pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  v2_max_monthly: process.env.STRIPE_PRICE_MAX_MONTHLY || '',
  v2_max_annual: process.env.STRIPE_PRICE_MAX_ANNUAL || '',
  // Credit packs
  v2_credits_1000: process.env.STRIPE_PRICE_CREDITS_1000 || '',
  v2_credits_3000: process.env.STRIPE_PRICE_CREDITS_3000 || '',
  v2_credits_10000: process.env.STRIPE_PRICE_CREDITS_10000 || '',
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;
export type CreditPackId = typeof CREDIT_PACKS[number]['id'];
