// Penworth v2 Plan Configuration
// DO NOT MODIFY - This follows the exact v2 pricing specification
// IMPORTANT: 1000 credits = 1 document. Credits ARE the document limit.

export type PublishingConnector = 'kdp' | 'ingram_spark' | 'd2d' | 'lulu' | 'google_play';

export const CREDIT_COSTS = {
  standardDocument: 1_000, // 1 document costs 1000 credits
} as const;

/**
 * Credit costs for publishing operations. Tier 2 auto-publish burns
 * small amounts (single API call, bounded cost). Penworth Computer
 * sessions burn significantly more — a full Kobo publish uses
 * ~30-60 Claude opus turns with screenshot vision inputs each turn.
 *
 * `rerun_*` entries (CEO-108) are charged when a writer jumps backward
 * in the pipeline and asks for a stage to actually re-execute. Forward
 * jumps and zero-work jumps (e.g. "go look at Cover again") stay free —
 * those just call POST /api/interview-session action='jump'. The ladder
 * is sized to the real compute each agent burns, balance-first.
 */
export const PUBLISHING_CREDIT_COSTS = {
  /** Direct API auto-publish: D2D, Gumroad, Payhip */
  tier2_api: 50,
  /** Penworth Computer browser automation session (any platform) */
  computer_use: 500,

  // CEO-108: backward-jump rerun ladder. Keys mirror AgentName from
  // lib/pipeline/heartbeat.ts so callers can index directly:
  //   PUBLISHING_CREDIT_COSTS[`rerun_${agent}` as keyof ...]
  rerun_validate: 100,
  rerun_interview: 200,
  rerun_research: 400,
  rerun_outline: 300,
  rerun_writing: 1_000,
  rerun_qa: 200,
  rerun_cover: 300,
  rerun_publishing: 50,
} as const;

/** Helper: cost to rerun a specific agent stage. Returns 0 if the
 *  agent name isn't ladder-tracked (defensive — should never happen
 *  for valid AgentName values). */
export function getRerunCost(agent: string): number {
  const key = `rerun_${agent}` as keyof typeof PUBLISHING_CREDIT_COSTS;
  const v = PUBLISHING_CREDIT_COSTS[key];
  return typeof v === 'number' ? v : 0;
}

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
  freeDocumentFirstMonth?: boolean; // Only for free tier
}> = {
  free: {
    monthlyCredits: 1_000, // = 1 document for first month only
    models: ['claude-haiku-4.5'],
    exportFormats: ['pdf'],
    hasBranding: true, // Has small "by penworth.ai" watermark - removed on top-up or referral
    publishingConnectors: ['kdp'],
    industryPrompts: ['general'],
    marketplaceSell: false,
    creditRolloverMax: 0,
    canBuyCredits: true, // FREE USERS CAN TOP UP ANYTIME
    supportLevel: 'community',
    freeDocumentFirstMonth: true, // 1 free document for first month only, then must top up or upgrade
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

/**
 * Check if user should have branding/watermark removed
 * Watermark is removed if:
 * - User is on paid plan (Pro/Max)
 * - User is on free plan but has topped up credits
 * - User is on free plan but has successful referrals
 */
export function shouldHaveWatermark(
  subscriptionTier: string,
  hasToppedUp: boolean,
  referralCount: number
): boolean {
  // Paid plans never have watermark
  if (subscriptionTier === 'pro' || subscriptionTier === 'max') {
    return false;
  }
  
  // Free tier: remove watermark if topped up or has referrals
  if (subscriptionTier === 'free' || !subscriptionTier) {
    if (hasToppedUp || referralCount > 0) {
      return false;
    }
    return true;
  }
  
  return true;
}

/**
 * Check if free user can still use their free monthly document
 * Free tier gets 1 document free for the FIRST MONTH only
 * After that, they must top up or upgrade to continue writing
 * But their account stays active forever
 */
export function canUseFreeDocument(
  accountCreatedAt: Date,
  documentsCreatedThisMonth: number
): boolean {
  const now = new Date();
  const accountCreatedDate = new Date(accountCreatedAt);
  
  // Check if within first month of account creation
  const oneMonthAfterCreation = new Date(accountCreatedDate);
  oneMonthAfterCreation.setMonth(oneMonthAfterCreation.getMonth() + 1);
  
  if (now <= oneMonthAfterCreation) {
    // Within first month - can use 1 free document
    return documentsCreatedThisMonth < 1;
  }
  
  // After first month - must top up or upgrade
  return false;
}

export const CREDIT_PACKS = [
  { id: 'v2_credits_1000', name: 'Single', credits: 1_000, price: 39, priceInCents: 3_900 },
  { id: 'v2_credits_3000', name: 'Triple', credits: 3_000, price: 99, priceInCents: 9_900 },
  { id: 'v2_credits_10000', name: 'Bulk', credits: 10_000, price: 290, priceInCents: 29_000 },
] as const;

/**
 * Resolve a Stripe price ID from env with a canonical fallback.
 *
 * Honours the env override only when it looks like a valid Stripe price ID
 * (starts with 'price_', length ≥ 20). Empty strings, whitespace, and stale
 * IDs from a different environment fall back to the canonical hardcoded ID.
 * Mirrors resolvePriceId() in app/api/stripe/checkout/route.ts.
 */
function resolveStripePriceId(envValue: string | undefined, canonical: string): string {
  const trimmed = (envValue ?? '').trim();
  if (trimmed.startsWith('price_') && trimmed.length >= 20) {
    return trimmed;
  }
  return canonical;
}

export const STRIPE_PRODUCTS = {
  // Subscription products - v2 pricing
  v2_pro_monthly: resolveStripePriceId(process.env.STRIPE_PRICE_PRO_MONTHLY, 'price_1TM8vSDAwDFDea8Lx2HRVsvb'),
  v2_pro_annual: resolveStripePriceId(process.env.STRIPE_PRICE_PRO_ANNUAL, 'price_1TM8yKDAwDFDea8Lia58tjN2'),
  v2_max_monthly: resolveStripePriceId(process.env.STRIPE_PRICE_MAX_MONTHLY, 'price_1TM8xADAwDFDea8Ld0hDB5mO'),
  v2_max_annual: resolveStripePriceId(process.env.STRIPE_PRICE_MAX_ANNUAL, 'price_1TM8zQDAwDFDea8LyLGIX1Ek'),
  // Credit packs
  v2_credits_1000: resolveStripePriceId(process.env.STRIPE_PRICE_CREDITS_1000, 'price_1TM90DDAwDFDea8LXyYMDoYU'),
  v2_credits_3000: resolveStripePriceId(process.env.STRIPE_PRICE_CREDITS_3000, 'price_1TM91IDAwDFDea8LFYWHxO1C'),
  v2_credits_10000: resolveStripePriceId(process.env.STRIPE_PRICE_CREDITS_10000, 'price_1TM91zDAwDFDea8LlLpGQetJ'),
} as const;

export type PlanId = 'free' | 'pro' | 'max';
export type CreditPackId = typeof CREDIT_PACKS[number]['id'];
