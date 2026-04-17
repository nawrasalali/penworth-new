import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: {
    default: 'The Penworth Guild — Turn your voice into income',
    template: '%s | The Penworth Guild',
  },
  description:
    'A craftsperson\'s path to building an income by referring authors to Penworth. Five tiers from Apprentice to Fellow. Commission every month for 12 months per referral. Free to apply.',
  keywords: [
    'penworth guild',
    'penworth partners',
    'affiliate program',
    'referral income',
    'ai book writing affiliate',
  ],
  openGraph: {
    type: 'website',
    url: 'https://guild.penworth.ai',
    title: 'The Penworth Guild',
    description: 'A craftsperson\'s path to earning an income introducing authors to Penworth.',
    siteName: 'The Penworth Guild',
  },
};

export default function GuildLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-[#e7e2d4] antialiased">
      <GuildHeader />
      <main className="relative">{children}</main>
      <GuildFooter />
    </div>
  );
}

function GuildHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#1e2436] bg-[#0a0e1a]/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/guild" className="flex items-center gap-3">
          <GuildMark />
          <span className="font-serif text-lg tracking-wide">
            The Penworth <span className="text-[#d4af37]">Guild</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-10 text-sm md:flex">
          <Link href="/guild/ladder" className="text-[#c9c2b0] transition hover:text-[#e7e2d4]">
            The Ladder
          </Link>
          <Link href="/guild/agents" className="text-[#c9c2b0] transition hover:text-[#e7e2d4]">
            AI Support
          </Link>
          <Link href="/guild/faq" className="text-[#c9c2b0] transition hover:text-[#e7e2d4]">
            FAQ
          </Link>
          <Link
            href="/guild/apply"
            className="rounded-md border border-[#d4af37] bg-[#d4af37] px-5 py-2 text-sm font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to Join
          </Link>
        </nav>
        <Link
          href="/guild/apply"
          className="rounded-md border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-medium text-[#0a0e1a] md:hidden"
        >
          Apply
        </Link>
      </div>
    </header>
  );
}

function GuildFooter() {
  return (
    <footer className="mt-32 border-t border-[#1e2436] bg-[#070a12]">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <GuildMark />
              <span className="font-serif text-base tracking-wide">
                The Penworth <span className="text-[#d4af37]">Guild</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[#8a8370]">
              A craftsperson&apos;s path to building an income by introducing authors to Penworth.
            </p>
          </div>

          <div>
            <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
              The Guild
            </div>
            <ul className="space-y-3 text-sm text-[#c9c2b0]">
              <li>
                <Link href="/guild/ladder" className="hover:text-[#e7e2d4]">
                  The Ladder
                </Link>
              </li>
              <li>
                <Link href="/guild/agents" className="hover:text-[#e7e2d4]">
                  AI Support Team
                </Link>
              </li>
              <li>
                <Link href="/guild/academy" className="hover:text-[#e7e2d4]">
                  The Academy
                </Link>
              </li>
              <li>
                <Link href="/guild/community" className="hover:text-[#e7e2d4]">
                  Community
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
              Apply
            </div>
            <ul className="space-y-3 text-sm text-[#c9c2b0]">
              <li>
                <Link href="/guild/apply" className="hover:text-[#e7e2d4]">
                  Start an Application
                </Link>
              </li>
              <li>
                <Link href="/guild/faq" className="hover:text-[#e7e2d4]">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/guild/status" className="hover:text-[#e7e2d4]">
                  Check Application Status
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
              Penworth
            </div>
            <ul className="space-y-3 text-sm text-[#c9c2b0]">
              <li>
                <a href="https://penworth.ai" className="hover:text-[#e7e2d4]">
                  penworth.ai
                </a>
              </li>
              <li>
                <Link href="/guild/terms" className="hover:text-[#e7e2d4]">
                  Guildmember Agreement
                </Link>
              </li>
              <li>
                <Link href="/guild/privacy" className="hover:text-[#e7e2d4]">
                  Privacy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-[#1e2436] pt-8 text-xs text-[#6b6452] md:flex-row">
          <div>
            © {new Date().getFullYear()} Penworth — A.C.N. 675 668 710 PTY LTD · Adelaide, Australia
          </div>
          <div className="font-serif italic text-[#8a8370]">
            &ldquo;The craft advances through those who advance the craft.&rdquo;
          </div>
        </div>
      </div>
    </footer>
  );
}

function GuildMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-[#d4af37]"
    >
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <path
        d="M12 28 L20 8 L28 28 M14.5 22 L25.5 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
