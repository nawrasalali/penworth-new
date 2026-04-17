import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy',
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-12">
        <Link href="/guild" className="text-sm text-[#8a8370] hover:text-[#e7e2d4]">
          ← Back to the Guild
        </Link>
      </div>

      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Legal
      </div>
      <h1 className="font-serif text-5xl leading-tight tracking-tight">Privacy Policy</h1>
      <p className="mt-4 text-sm text-[#8a8370]">
        Effective date: 17 April 2026 · Applies to The Penworth Guild
      </p>

      <div className="prose-custom mt-12 space-y-8 text-[#c9c2b0] [&_a]:text-[#d4af37] [&_a:hover]:underline [&_li]:ml-6 [&_li]:list-disc [&_li]:py-1 [&_strong]:text-[#e7e2d4]">
        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">Summary</h2>
          <p className="text-sm leading-relaxed">
            We collect the minimum data necessary to operate the Guild. We encrypt sensitive data at
            rest. We do not sell your data. You can request deletion at any time.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">
            What we collect
          </h2>
          <div className="space-y-4 text-sm leading-relaxed">
            <p><strong>When you apply:</strong></p>
            <ul>
              <li>Your name, email, country, and preferred language</li>
              <li>Links to your public online presence (optional)</li>
              <li>Your motivation statement</li>
              <li>Your IP address and browser user agent (for fraud review)</li>
            </ul>
            <p><strong>If you are accepted:</strong></p>
            <ul>
              <li>Your voice interview recording and transcript</li>
              <li>Your payout method and encrypted payout details (Wise email or USDT wallet)</li>
              <li>Your tax residency and encrypted tax ID number</li>
              <li>Your referral and commission history</li>
              <li>Your interactions with the Guild&apos;s AI support agents</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">How we use it</h2>
          <ul className="text-sm leading-relaxed">
            <li>To operate the Guild — review applications, track referrals, calculate commissions, process payouts</li>
            <li>To provide the AI support agents with context needed to help you</li>
            <li>To prevent fraud and protect other Guildmembers</li>
            <li>To comply with legal obligations (tax reporting, financial record-keeping)</li>
            <li>To communicate with you about your Guild membership</li>
          </ul>
          <p className="mt-4 text-sm leading-relaxed">
            We <strong>do not</strong> sell your data to third parties. We do not use your data for
            advertising.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">
            Third parties we share data with
          </h2>
          <ul className="text-sm leading-relaxed">
            <li><strong>Supabase</strong> (database hosting) — your Guild data</li>
            <li><strong>Anthropic</strong> (Claude AI) — to run the AI support agents</li>
            <li><strong>ElevenLabs / Whisper</strong> — for voice interview synthesis & transcription</li>
            <li><strong>Resend</strong> — to send you Guild emails</li>
            <li><strong>Stripe</strong> — for commission-source subscription data</li>
            <li><strong>Wise / USDT network</strong> — to deliver your payouts</li>
          </ul>
          <p className="mt-4 text-sm leading-relaxed">
            Each of these processors has a data processing agreement with Penworth.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">
            Encryption & security
          </h2>
          <p className="text-sm leading-relaxed">
            Payout details, tax identification numbers, and voice interview recordings are encrypted
            at rest with AES-256. Encryption keys are held separately from the database.
            Transmission to all processors is over TLS.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">Your rights</h2>
          <p className="text-sm leading-relaxed">
            Regardless of your location, you have the right to:
          </p>
          <ul className="text-sm leading-relaxed">
            <li>Access a copy of the data we hold about you</li>
            <li>Correct inaccurate data</li>
            <li>Delete your data (subject to legal retention obligations, e.g. 7 years of financial records)</li>
            <li>Object to specific processing</li>
            <li>Withdraw consent at any time</li>
          </ul>
          <p className="mt-4 text-sm leading-relaxed">
            To exercise any of these rights, email{' '}
            <a href="mailto:privacy@penworth.ai">privacy@penworth.ai</a>. We respond within 30 days.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">
            Retention
          </h2>
          <p className="text-sm leading-relaxed">
            We retain application data for 3 years to inform future reapplications. Guildmember
            data is retained for the duration of membership plus 7 years after termination
            (to comply with Australian financial record-keeping law). Commission and payout records
            are retained for 7 years.
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">Contact</h2>
          <p className="text-sm leading-relaxed">
            Data privacy questions:{' '}
            <a href="mailto:privacy@penworth.ai">privacy@penworth.ai</a>
            <br />
            Company: A.C.N. 675 668 710 PTY LTD, Adelaide, South Australia
          </p>
        </section>
      </div>
    </div>
  );
}
