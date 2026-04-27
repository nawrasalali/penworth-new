import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Academy — How Guildmembers Learn the Craft',
  description:
    'The Penworth Guild Academy: short audio-led modules that unlock your referral link and teach you to represent Penworth well. Three mandatory modules, six electives, about 4.5 hours total.',
};

const TIER_ORDER = ['apprentice', 'journeyman', 'artisan', 'master', 'fellow'] as const;

type ModuleRecord = {
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  order_index: number;
  required_tier: string | null;
  estimated_minutes: number | null;
};

function tierLabel(tier: string | null): string {
  if (!tier) return 'Apprentice';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatHours(min: number): string {
  if (min < 60) return `${min} minutes`;
  const hours = Math.floor(min / 60);
  const remainder = min % 60;
  if (remainder === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${remainder}m`;
}

export default async function AcademyMarketingPage() {
  const admin = createServiceClient();
  const { data: modulesRaw } = await admin
    .from('guild_academy_modules')
    .select('slug, title, subtitle, category, order_index, required_tier, estimated_minutes')
    .eq('published', true)
    .order('category', { ascending: true })
    .order('order_index', { ascending: true });

  const modules: ModuleRecord[] = (modulesRaw as ModuleRecord[]) || [];
  const mandatory = modules.filter((m) => m.category === 'mandatory');
  const electives = modules.filter((m) => m.category === 'elective');
  const totalMinutes = modules.reduce((s, m) => s + (m.estimated_minutes || 0), 0);
  const mandatoryMinutes = mandatory.reduce((s, m) => s + (m.estimated_minutes || 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Hero */}
      <div className="mb-12 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          The Academy
        </div>
        <h1 className="mt-4 font-serif text-5xl tracking-tight text-[#e7e2d4] md:text-6xl">
          Learn the craft. Earn the link.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#8a8370]">
          When you join the Guild, you commit to representing Penworth — to your readers,
          your audience, and the writers you bring in. The Academy is how we make sure you
          can do that with confidence. Three short audio-led modules unlock your referral
          link. Six more deepen the craft as you climb the tiers.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/guild/apply"
            className="rounded-lg border border-[#d4af37] bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to the Guild
          </Link>
          <Link
            href="/guild/login"
            className="rounded-lg border border-[#2a3149] bg-transparent px-6 py-3 text-sm font-semibold text-[#e7e2d4] transition hover:border-[#d4af37]"
          >
            Member sign in
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      <div className="mb-14 grid grid-cols-3 gap-4 rounded-2xl border border-[#1e2436] bg-[#0f1424] p-6">
        <Stat value={`${modules.length}`} label="Total modules" />
        <Stat value={`${mandatory.length}`} label="Mandatory" accent />
        <Stat value={formatHours(totalMinutes)} label="Total runtime" />
      </div>

      {/* How it works */}
      <section className="mb-14">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          How it works
        </div>
        <h2 className="mb-6 font-serif text-3xl tracking-tight text-[#e7e2d4]">
          Audio-led, checkpoint-paced, progress-tracked.
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Block
            n="01"
            title="Listen, don't read"
            body="Each module is a short audio lesson — designed for the kitchen, the commute, the walk. Transcripts are available, but the format is voice."
          />
          <Block
            n="02"
            title="Checkpoints, not exams"
            body="Brief comprehension checks between segments. They're there to make sure the material landed, not to gatekeep. Get one wrong, hear it again, move on."
          />
          <Block
            n="03"
            title="Your link unlocks"
            body={`Finishing all ${mandatory.length} mandatory modules — about ${formatHours(mandatoryMinutes)} — activates your unique referral link automatically. No manual approval step.`}
          />
          <Block
            n="04"
            title="Electives unlock by tier"
            body="Three electives are open the day you join. The remaining three unlock as you advance: Artisan Playbook at Journeyman, Master Discipline at Artisan, the Fellow Path at Master."
          />
        </div>
      </section>

      {/* Mandatory modules preview */}
      {mandatory.length > 0 && (
        <section className="mb-14">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            What you&apos;ll learn — Mandatory
          </div>
          <h2 className="mb-2 font-serif text-3xl tracking-tight text-[#e7e2d4]">
            The three modules that unlock your link.
          </h2>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
            These cover the program, the money, and the conduct. We don&apos;t skip them
            because all three protect you, your audience, and the writers you bring in.
          </p>
          <div className="space-y-3">
            {mandatory.map((m) => (
              <ModulePreview key={m.slug} mod={m} highlight />
            ))}
          </div>
        </section>
      )}

      {/* Electives preview */}
      {electives.length > 0 && (
        <section className="mb-14">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Going deeper — Electives
          </div>
          <h2 className="mb-2 font-serif text-3xl tracking-tight text-[#e7e2d4]">
            Six electives. Open as you climb.
          </h2>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
            From practical (using the seven agents, finding your first five referrals) to
            advanced (the Master discipline, the Fellow path). Optional, but most members
            do them.
          </p>
          <div className="space-y-3">
            {electives.map((m) => (
              <ModulePreview key={m.slug} mod={m} />
            ))}
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <section className="rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-8 text-center">
        <h2 className="font-serif text-3xl tracking-tight text-[#e7e2d4]">
          The Academy is part of the Guild — not a separate purchase.
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[#8a8370]">
          Every Guildmember gets all nine modules at no cost, in eleven languages, for as
          long as they&apos;re a Guildmember. The only way in is through the application.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/guild/apply"
            className="rounded-lg border border-[#d4af37] bg-[#d4af37] px-6 py-3 text-sm font-semibold text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Start your application
          </Link>
          <Link
            href="/guild/ladder"
            className="rounded-lg border border-[#2a3149] bg-transparent px-6 py-3 text-sm font-semibold text-[#e7e2d4] transition hover:border-[#d4af37]"
          >
            See the five tiers
          </Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div
        className={`font-serif text-3xl tracking-tight ${accent ? 'text-[#d4af37]' : 'text-[#e7e2d4]'}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-[#8a8370]">
        {label}
      </div>
    </div>
  );
}

function Block({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-5">
      <div className="font-serif text-xs text-[#d4af37]">{n}</div>
      <h3 className="mt-1 font-serif text-lg tracking-tight text-[#e7e2d4]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8370]">{body}</p>
    </div>
  );
}

function ModulePreview({ mod, highlight }: { mod: ModuleRecord; highlight?: boolean }) {
  const tierTag =
    mod.required_tier && TIER_ORDER.includes(mod.required_tier as (typeof TIER_ORDER)[number])
      ? tierLabel(mod.required_tier)
      : null;
  const minutes = mod.estimated_minutes ? `${mod.estimated_minutes} min` : null;

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border p-5 ${
        highlight
          ? 'border-[#d4af37]/30 bg-[#d4af37]/5'
          : 'border-[#1e2436] bg-[#0f1424]'
      }`}
    >
      <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#2a3149] bg-[#0a0e1a]">
        <span className="font-serif text-sm text-[#8a8370]">{mod.order_index}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-lg tracking-tight text-[#e7e2d4]">{mod.title}</h3>
          <div className="flex flex-shrink-0 items-center gap-2">
            {minutes && (
              <span className="rounded-full border border-[#2a3149] px-3 py-0.5 text-xs text-[#8a8370]">
                {minutes}
              </span>
            )}
            {tierTag && tierTag !== 'Apprentice' && !highlight && (
              <span className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-3 py-0.5 text-xs text-[#d4af37]">
                Unlocks at {tierTag}
              </span>
            )}
          </div>
        </div>
        {mod.subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-[#8a8370]">{mod.subtitle}</p>
        )}
      </div>
    </div>
  );
}
