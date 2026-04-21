'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function GuildLoginInner() {
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/guild/dashboard';
  const [loginUrl, setLoginUrl] = useState<string>('');

  useEffect(() => {
    // Build an absolute URL to the main Penworth login.
    // Auth cookies are shared across `.penworth.ai`, so once a user logs in on
    // the main site, they are authenticated on guild.penworth.ai too.
    const base =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' && window.location.hostname.includes('localhost')
        ? `${window.location.protocol}//${window.location.host}`
        : 'https://penworth.ai');
    const returnUrl = `https://guild.penworth.ai${redirectPath}`;
    setLoginUrl(`${base}/login?redirect=${encodeURIComponent(returnUrl)}`);
  }, [redirectPath]);

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-serif text-4xl leading-tight tracking-tight">
        Sign in to your <span className="italic text-[#d4af37]">Guildmember</span> account.
      </h1>
      <p className="mx-auto mt-8 max-w-sm text-base leading-relaxed text-[#c9c2b0]">
        Your account is shared across Penworth. Sign in on the main site and you&apos;ll land back
        in your Guild dashboard.
      </p>

      <div className="mt-12">
        {loginUrl ? (
          <a
            href={loginUrl}
            className="inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-8 py-4 text-base font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Sign In →
          </a>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-md bg-[#1e2436] px-8 py-4 text-base font-medium text-[#8a8370]">
            Preparing sign-in…
          </div>
        )}
      </div>

      <div className="mt-16 space-y-4 text-sm text-[#8a8370]">
        <div>
          Not a Guildmember yet?{' '}
          <Link href="/guild/apply" className="text-[#d4af37] hover:underline">
            Apply to join
          </Link>
        </div>
        <div>
          Applied and waiting?{' '}
          <Link href="/guild/status" className="text-[#d4af37] hover:underline">
            Check your application status
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function GuildLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <GuildLoginInner />
    </Suspense>
  );
}
