import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { t, type Locale, type StringKey } from '@/lib/i18n/strings';

/**
 * ShowcaseGrantsCard — Phase 1E Task 1E.2
 *
 * Renders the 5-tile grid of a Guildmember's showcase grants. Each tile
 * shows the category name, the grant's state (unused / used / expired),
 * and a state-aware CTA.
 *
 * Data source per Phase 1E pre-flight note #1: we query guild_showcase_grants
 * DIRECTLY (not v_guild_showcase_grants_summary, which is aggregate-only
 * and returns no per-category row data). ORDER BY category gives stable
 * tile ordering.
 *
 * The server component fetches its own data — the parent page only needs
 * to pass memberId + locale. Kept server-side so no data flies to the
 * client; the card is pure output.
 */

const CATEGORIES = ['book', 'business', 'academic', 'legal', 'technical'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_LABEL_KEY: Record<Category, StringKey> = {
  book: 'grants.categoryBook',
  business: 'grants.categoryBusiness',
  academic: 'grants.categoryAcademic',
  legal: 'grants.categoryLegal',
  technical: 'grants.categoryTechnical',
};

/**
 * Content type default used to pre-fill the new-project flow from a
 * specific category tile. These must map to a content_type that the
 * guild_content_type_to_category function routes back into the correct
 * macro category — otherwise the user would click "Create a Book →"
 * and end up with a business doc.
 */
const CATEGORY_TO_CREATE_CONTENT_TYPE: Record<Category, string> = {
  book: 'book',
  business: 'business',
  academic: 'academic',
  legal: 'contract',
  technical: 'technical',
};

interface GrantRow {
  id: string;
  category: Category;
  status: 'unused' | 'used' | 'expired';
  project_id: string | null;
  used_at: string | null;
}

export async function ShowcaseGrantsCard({
  memberId,
  locale,
}: {
  memberId: string;
  locale: Locale;
}) {
  const admin = createAdminClient();

  // Per Phase 1E pre-flight #1: query the table directly — the view is
  // aggregate-only. Filter by the member, order by category for stable
  // tile placement.
  const { data: grants, error } = await admin
    .from('guild_showcase_grants')
    .select('id, category, status, project_id, used_at')
    .eq('guildmember_id', memberId)
    .order('category');

  if (error || !grants || grants.length === 0) {
    // No grants yet (member just accepted and trigger hasn't run, or the
    // select failed). Fail quietly — this is a cosmetic panel, not a gate.
    return null;
  }

  const rows = grants as GrantRow[];
  const byCategory = new Map<Category, GrantRow>();
  for (const r of rows) byCategory.set(r.category, r);

  const unusedCount = rows.filter((r) => r.status === 'unused').length;

  return (
    <section className="mt-12 rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            {t('grants.cardTitle', locale)}
          </div>
          <h2 className="mt-1 font-serif text-2xl tracking-tight text-neutral-100">
            {t('grants.cardSubtext', locale)}
          </h2>
        </div>
        <div className="text-xs text-[#8a8370]">
          {t('grants.remainingLabel', locale).replace('{count}', String(unusedCount))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CATEGORIES.map((cat) => {
          const grant = byCategory.get(cat);
          const categoryLabel = t(CATEGORY_LABEL_KEY[cat], locale);
          // Defensive — if a category is missing (shouldn't happen, trigger
          // creates exactly 5 on acceptance), render as unused.
          const status = grant?.status ?? 'unused';

          return (
            <GrantTile
              key={cat}
              category={cat}
              categoryLabel={categoryLabel}
              status={status}
              projectId={grant?.project_id ?? null}
              locale={locale}
            />
          );
        })}
      </div>
    </section>
  );
}

function GrantTile({
  category,
  categoryLabel,
  status,
  projectId,
  locale,
}: {
  category: Category;
  categoryLabel: string;
  status: 'unused' | 'used' | 'expired';
  projectId: string | null;
  locale: Locale;
}) {
  const stateLabel =
    status === 'unused'
      ? t('grants.stateUnused', locale)
      : status === 'used'
        ? t('grants.stateUsed', locale)
        : t('grants.stateExpired', locale);

  const stateClass =
    status === 'unused'
      ? 'bg-[#d4af37]/10 text-[#d4af37]'
      : status === 'used'
        ? 'bg-green-500/10 text-green-400'
        : 'bg-gray-500/10 text-gray-400';

  const contentTypeForCreate = CATEGORY_TO_CREATE_CONTENT_TYPE[category];

  return (
    <div className="flex h-full flex-col rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="font-medium text-neutral-100">{categoryLabel}</div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${stateClass}`}>
          {stateLabel}
        </span>
      </div>
      <div className="mt-auto pt-3 text-sm">
        {status === 'unused' && (
          <Link
            href={`/projects/new?content_type=${encodeURIComponent(contentTypeForCreate)}`}
            className="text-[#d4af37] hover:underline"
          >
            {t('grants.createCta', locale).replace('{category}', categoryLabel)}
          </Link>
        )}
        {status === 'used' && projectId && (
          <Link
            href={`/projects/${projectId}`}
            className="text-green-400 hover:underline"
          >
            {t('grants.viewProjectLink', locale)}
          </Link>
        )}
        {status === 'expired' && (
          <span className="text-[#6b6452]">—</span>
        )}
      </div>
    </div>
  );
}
