import Link from 'next/link';

export const metadata = {
  title: 'Guildmember Agreement',
};

export default function TermsPage() {
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
      <h1 className="font-serif text-5xl leading-tight tracking-tight">
        Guildmember Agreement
      </h1>
      <p className="mt-4 text-sm text-[#8a8370]">Effective date: 17 April 2026 · Version 1.0</p>

      <div className="prose-custom mt-12 space-y-8 text-[#c9c2b0]">
        <Section title="1. Parties & Scope">
          <p>
            This Guildmember Agreement (&ldquo;Agreement&rdquo;) is between you (&ldquo;Guildmember&rdquo;)
            and <strong>A.C.N. 675 668 710 PTY LTD</strong>, the Australian company operating
            Penworth.ai (&ldquo;Penworth&rdquo;). It governs your participation in The Penworth Guild
            (&ldquo;the Guild&rdquo;).
          </p>
          <p>
            By submitting an application to the Guild, you agree to this Agreement. If you are
            accepted as a Guildmember, this Agreement governs your relationship with Penworth for
            the duration of your membership.
          </p>
        </Section>

        <Section title="2. Independent Contractor Relationship">
          <p>
            Guildmembers are <strong>independent contractors</strong>, not employees, agents,
            partners, or franchisees of Penworth. Nothing in this Agreement creates an employment
            relationship. Guildmembers are responsible for their own tax obligations in their
            jurisdiction of residence.
          </p>
        </Section>

        <Section title="3. Commission Structure">
          <p>Commission is earned on the following basis:</p>
          <ul>
            <li>
              Commission applies to <strong>first-tier referrals only</strong> — users who subscribe
              to Penworth through the Guildmember&apos;s unique referral code or link.
            </li>
            <li>
              Commission is calculated as a <strong>percentage of the referred user&apos;s monthly
              subscription fee</strong>, at the plan price originally subscribed to, for{' '}
              <strong>12 consecutive months</strong> from the referred user&apos;s first paid month.
            </li>
            <li>
              The commission percentage is determined by the Guildmember&apos;s <strong>tier at the
              time of referral</strong> (Apprentice 20%, Journeyman 25%, Artisan 30%, Master 35%,
              Fellow 40%) and is <strong>locked at that rate</strong> for the full 12-month window.
            </li>
            <li>
              Commission is <strong>not paid on plan upgrades</strong> beyond the originally
              referred plan, nor on <strong>credit pack purchases</strong>.
            </li>
            <li>
              Commission on a month in which the referred user is refunded is <strong>clawed back</strong>{' '}
              from the Guildmember&apos;s next payout.
            </li>
            <li>
              Commission on a chargeback is clawed back in full, including prior months paid on that
              referred user.
            </li>
          </ul>
        </Section>

        <Section title="4. Payouts">
          <p>
            Payouts are processed on the <strong>last business day of each calendar month</strong>{' '}
            at midnight Adelaide time. Payments are made via the method the Guildmember has selected
            in their dashboard settings:
          </p>
          <ul>
            <li><strong>Wise</strong> — bank transfer in local currency</li>
            <li><strong>USDT</strong> — stablecoin transfer (Ethereum or Tron network)</li>
          </ul>
          <p>
            Minimum payout threshold: <strong>$50 USD</strong>. Balances below this threshold roll
            forward to the next month with no penalty or fees.
          </p>
        </Section>

        <Section title="5. Tier Advancement">
          <p>
            Advancement through the five Guild tiers is based on <strong>active retained
            referrals</strong> — referred users who have been paid subscribers for at least 60
            consecutive days.
          </p>
          <p>
            Full advancement criteria are published and maintained at{' '}
            <Link href="/guild/ladder" className="text-[#d4af37] hover:underline">
              guild.penworth.ai/ladder
            </Link>{' '}
            and are incorporated by reference into this Agreement.
          </p>
          <p>
            Penworth may adjust advancement criteria on a forward-looking basis. Existing tier status
            and existing commission obligations on in-flight referrals are not affected by such
            adjustments.
          </p>
        </Section>

        <Section title="6. Community Guidelines & Conduct">
          <p>Guildmembers agree to:</p>
          <ul>
            <li>Represent Penworth honestly and not overstate the product&apos;s capabilities.</li>
            <li>Disclose their Guildmember status when recommending Penworth, per applicable
              laws (including the U.S. FTC endorsement guide where relevant).</li>
            <li>Refrain from spam, unsolicited bulk messaging, and aggressive outreach.</li>
            <li>Respect the privacy of referred users and any personal data shared with them.</li>
            <li>Use only pre-approved Penworth brand marks and comply with brand guidelines.</li>
            <li>Refrain from impersonating Penworth staff or Guild Council members.</li>
          </ul>
        </Section>

        <Section title="7. Termination & Appeals">
          <p>Penworth may terminate a Guildmember&apos;s participation for:</p>
          <ul>
            <li>Confirmed fraud, including self-referral, bot-driven signups, or payment fraud.</li>
            <li>Three or more Community Guideline violations within any 12-month period.</li>
            <li>Material breach of this Agreement.</li>
            <li>Impersonation of Penworth or Guild Council personnel.</li>
          </ul>
          <p>
            Upon termination: future commission payments cease immediately; pending unvested
            commissions are forfeited; vested and paid commissions are not clawed back unless
            fraudulently obtained; dashboard access is revoked; and the Guildmember is banned from
            reapplying for 2 years.
          </p>
          <p>
            Guildmembers may appeal termination within 14 days. Appeals are reviewed by a
            three-member panel of Guild Fellows (not including any Fellow who flagged the case). The
            appeal decision is final.
          </p>
        </Section>

        <Section title="8. Fraud Prevention">
          <p>
            Penworth may flag and investigate activity including (but not limited to): self-referral
            patterns, referral volume exceeding 100 per 24 hours or 500 per 7 days, referred users
            with abnormal chargeback or refund rates, and suspicious IP or device fingerprint
            patterns. Penworth reserves the right to hold or reverse commissions pending
            investigation.
          </p>
        </Section>

        <Section title="9. Tax Compliance">
          <p>
            Guildmembers are solely responsible for their own tax obligations. Penworth does not
            withhold tax from payouts. By 31 January each year, Penworth issues an annual earnings
            statement covering the prior calendar year. For U.S.-based Guildmembers earning above
            $600 in a calendar year, Penworth files Form 1099-NEC as required by IRS rules.
          </p>
        </Section>

        <Section title="10. Changes to this Agreement">
          <p>
            Penworth may modify this Agreement on 30 days&apos; notice via email and a notice in the
            Guildmember dashboard. Changes to commission rates or the 12-month window will not
            apply retroactively to referrals made before the effective date of the change.
          </p>
        </Section>

        <Section title="11. Governing Law & Disputes">
          <p>
            This Agreement is governed by the laws of <strong>South Australia, Australia</strong>.
            Disputes arising from or related to this Agreement shall be resolved by the courts of
            South Australia, unless otherwise required by the Guildmember&apos;s local jurisdiction.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about this Agreement may be directed to{' '}
            <a href="mailto:guild@penworth.ai" className="text-[#d4af37] hover:underline">
              guild@penworth.ai
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 font-serif text-2xl tracking-tight text-[#e7e2d4]">{title}</h2>
      <div className="space-y-4 text-sm leading-relaxed [&_a]:text-[#d4af37] [&_a:hover]:underline [&_li]:ml-6 [&_li]:list-disc [&_li]:py-1 [&_strong]:text-[#e7e2d4]">
        {children}
      </div>
    </section>
  );
}
