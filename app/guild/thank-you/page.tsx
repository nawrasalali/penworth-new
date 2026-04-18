import Link from 'next/link';

export default async function ThankYouPage(
  props: {
    searchParams: Promise<{ id?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <div className="mb-10 inline-flex h-20 w-20 items-center justify-center rounded-full border border-[#d4af37]/30 bg-[#d4af37]/5">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-[#d4af37]"
        >
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="font-serif text-5xl leading-tight tracking-tight md:text-6xl">
        Your application is <span className="italic text-[#d4af37]">with the Council</span>.
      </h1>

      <p className="mx-auto mt-10 max-w-2xl text-lg leading-relaxed text-[#c9c2b0]">
        Check your inbox in a moment — we&apos;ve sent you a confirmation. Within the next{' '}
        <strong className="text-[#e7e2d4]">30 minutes</strong>, you&apos;ll receive a second email
        with one of two outcomes.
      </p>

      <div className="mx-auto mt-12 max-w-2xl rounded-xl border border-[#1e2436] bg-[#0f1424] p-8 text-left">
        <div className="text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
          What happens next
        </div>
        <div className="mt-6 space-y-5">
          <Step
            n={1}
            title="Automated review (within 30 minutes)"
            body="Our system checks your application. This happens in the background — no action needed from you."
          />
          <Step
            n={2}
            title="Invitation to interview"
            body="If your application passes, you'll receive a link to book a 10-minute voice interview in your native language."
          />
          <Step
            n={3}
            title="Voice interview & decision"
            body="A conversational AI interview. You'll receive the Council's decision within 48 hours of completing it."
          />
          <Step
            n={4}
            title="Welcome to the Guild"
            body="If accepted, your dashboard is live immediately and your seven AI agents begin work."
          />
        </div>
      </div>

      {searchParams.id && (
        <p className="mt-10 text-xs text-[#6b6452]">
          Application reference: <span className="font-mono text-[#8a8370]">{searchParams.id}</span>
        </p>
      )}

      <div className="mt-16 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href="/guild/ladder"
          className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
        >
          Explore the ladder
        </Link>
        <Link
          href="/guild/faq"
          className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4] hover:border-[#3a4259]"
        >
          Read the FAQ
        </Link>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d4af37]/10 text-sm font-medium text-[#d4af37]">
          {n}
        </div>
      </div>
      <div>
        <div className="font-medium text-[#e7e2d4]">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-[#8a8370]">{body}</div>
      </div>
    </div>
  );
}
