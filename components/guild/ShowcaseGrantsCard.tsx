import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { t, type Locale } from '@/lib/i18n/strings';

/**
 * ShowcaseGrantsCard — migration 029 rewrite.
 *
 * NEW POLICY: Each Apprentice gets 3 free books on join, of any type the
 * writer chooses. No category gating. The "walk the talk" idea is that
 * Guildmembers must use Penworth as authors themselves before promoting
 * it.
 *
 * This card shows a flat count of unused grants and renders one tile per
 * grant. Tiles are not category-labelled — every grant is a generic
 * "free book". Used tiles deep-link to the project; unused tiles offer
 * a single CTA to start a new book of any kind.
 *
 * Backward compat: legacy members still have category-tagged grants
 * (book/business/academic/legal/technical) from migration 010 trigger
 * seeding. We render those as generic "Free book" too — the category
 * is preserved in the DB for audit but invisible to the user.
 */

interface GrantRow {
  id: string;
  category: string;
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
  const admin = createServiceClient();

  const { data: grants, error } = await admin
    .from('guild_showcase_grants')
    .select('id, category, status, project_id, used_at')
    .eq('guildmember_id', memberId)
    .order('granted_at', { ascending: true });

  if (error || !grants || grants.length === 0) return null;

  const rows = grants as GrantRow[];
  const unusedCount = rows.filter((r) => r.status === 'unused').length;
  const totalCount = rows.length;

  return (
    <section className="mt-12 rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            {t('grants.cardTitle', locale)}
          </div>
          <h2 className="mt-1 font-serif text-2xl tracking-tight text-neutral-100">
            Three free books — your choice of type
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[#8a8370]">
            Pick anything you want to write — a novel, a business plan, a
            memoir. Walk the talk before you sell Penworth to others.
          </p>
        </div>
        <div className="text-right">
          <div className="font-serif text-3xl text-[#d4af37]">
            {unusedCount}
            <span className="text-base text-[#8a8370]"> / {totalCount}</span>
          </div>
          <div className="text-xs uppercase tracking-widest text-[#8a8370]">
            Remaining
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((grant, idx) => (
          <GrantTile
            key={grant.id}
            slotNumber={idx + 1}
            status={grant.status}
            projectId={grant.project_id}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}

function GrantTile({
  slotNumber,
  status,
  projectId,
  locale,
}: {
  slotNumber: number;
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

  return (
    <div className="flex h-full flex-col rounded-lg border border-[#1e2436] bg-[#0a0e1a] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="font-medium text-neutral-100">
          Free book #{slotNumber}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${stateClass}`}>
          {stateLabel}
        </span>
      </div>
      <div className="mt-auto pt-3 text-sm">
        {status === 'unused' && (
          <Link
            href="/projects/new"
            className="text-[#d4af37] hover:underline"
          >
            Start writing →
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
