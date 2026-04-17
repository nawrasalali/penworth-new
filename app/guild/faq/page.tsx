import Link from 'next/link';

export const metadata = {
  title: 'Frequently Asked Questions',
};

const SECTIONS = [
  {
    heading: 'Joining the Guild',
    items: [
      {
        q: 'Is it really free to apply?',
        a: 'Yes. There is no application fee and no hidden cost. The Guild earns its revenue from the success of its members — we have no incentive to make joining expensive.',
      },
      {
        q: 'Do I need an existing audience to join?',
        a: 'No. Having a public presence (a social account, newsletter, blog) helps your Scout agent learn your audience faster, but it is not required. The Council reads your motivation statement carefully. We have admitted people with zero followers who went on to become Masters.',
      },
      {
        q: 'What happens in the voice interview?',
        a: 'A 10-minute conversation with our AI interviewer, in your native language. The AI asks about your background, your motivation, who you\'d introduce to Penworth, and your understanding of the product. Speak naturally — we\'re not testing you on knowledge.',
      },
      {
        q: 'What if I fail the interview?',
        a: 'You may reapply in 90 days. Your next application will get a fresh review. The ladder evolves; applicants strengthen over time.',
      },
      {
        q: 'What languages can I apply in?',
        a: 'The application form is in English, but your voice interview and all Guild communications will be in your chosen language: English, Spanish, Arabic, Portuguese, French, Hindi, Indonesian, Vietnamese, Bengali, Russian, or Chinese.',
      },
      {
        q: 'Can I be in the Guild if I\'m also a Penworth author?',
        a: 'Yes. Many Guildmembers write their own books on Penworth — it\'s how they know the product. Guild membership and authoring are independent; you can do both.',
      },
    ],
  },
  {
    heading: 'Earning commission',
    items: [
      {
        q: 'What exactly do I earn commission on?',
        a: 'A percentage (20-40%, based on your tier) of the monthly subscription price your referred user originally signed up at, for 12 consecutive months from their first paid month.',
      },
      {
        q: 'Do I earn commission on upgrades?',
        a: 'No. If Jane signs up for Pro at $19/month through your link and later upgrades to Max at $49/month, your commission continues at the Pro rate for the original 12-month window. We believe this is the simplest and fairest model.',
      },
      {
        q: 'Do I earn commission on credit pack purchases?',
        a: 'No. Commission applies to subscription revenue only.',
      },
      {
        q: 'What happens if someone I referred cancels?',
        a: 'Commission stops from the next billing cycle onward. Commission already paid is not clawed back unless the cancellation was a refund or chargeback.',
      },
      {
        q: 'When and how do I get paid?',
        a: 'Last business day of each month, midnight Adelaide time. Via Wise bank transfer or USDT stablecoin — your choice. $50 minimum payout; smaller balances roll to next month.',
      },
      {
        q: 'What if I earn more than $50,000 in a year?',
        a: 'At the Fellow tier, yearly commissions above $50,000 trigger a 10% bonus on all that year\'s commissions, paid in January.',
      },
    ],
  },
  {
    heading: 'The ladder',
    items: [
      {
        q: 'How long does it take to reach Journeyman?',
        a: 'Depends entirely on your audience and activity. Apprentices with active communities often hit 5 retained referrals within 4-8 weeks. Apprentices building their audience from scratch may take 3-6 months. Both paths are valid.',
      },
      {
        q: 'What is "retained referral"?',
        a: 'A user you referred who subscribed to a paid plan and stayed subscribed for at least 60 consecutive days. This ensures we\'re rewarding introductions that lead to fit, not just sign-ups.',
      },
      {
        q: 'What is the retention rate requirement?',
        a: 'Starting at Journeyman, you must maintain a retention rate above 70% (of referrals still subscribed at 90 days). This rises to 75% at Artisan and 80% at Master.',
      },
      {
        q: 'Can I be demoted?',
        a: 'Yes — through probation. If your retention rate drops below 60% for a full month, you enter a 30-day probation. If you can\'t recover above 65%, you are demoted one tier, with your commission rate adjusting on new referrals only.',
      },
      {
        q: 'What happens if a Fellow stops producing?',
        a: 'After 12 consecutive months without new referrals, a Fellow transitions to Emeritus status. They keep their title and Council seat (non-voting) but no longer earn the 40% rate on new referrals.',
      },
    ],
  },
  {
    heading: 'The AI support team',
    items: [
      {
        q: 'What do the seven AI agents actually do?',
        a: 'Scout audits your audience. Coach builds your personalised growth plan. Creator drafts your content. Mentor runs weekly check-ins. Analyst tracks performance. Strategist plans campaigns. Advisor answers product questions and coaches on objections.',
      },
      {
        q: 'Do the agents post on my behalf?',
        a: 'Never. All content created by your agents requires your review and manual posting. You always stay in control.',
      },
      {
        q: 'What language do the agents work in?',
        a: 'All seven agents operate in your chosen language. Your content, your plans, your check-ins — all in your language.',
      },
      {
        q: 'Can I talk to a human if the AI isn\'t enough?',
        a: 'Yes. At Journeyman tier and above, you have a dedicated Guild Success Manager. Below that, your Mentor agent will escalate to a human if it detects you\'re struggling.',
      },
    ],
  },
  {
    heading: 'Trust, safety, and fairness',
    items: [
      {
        q: 'Is this MLM?',
        a: 'No. The Penworth Guild pays commission on first-tier referrals only — the people you personally bring in. There is no multi-level structure, no override on other members\' earnings, no downline. The word "Guild" was chosen specifically because it has zero MLM association.',
      },
      {
        q: 'What if someone tries to steal my referrals?',
        a: 'Attribution is set at sign-up via the referral code in the URL and is immutable afterward. If you suspect theft, file a support ticket — we\'ll investigate with server logs. Attribution changes only with clear technical evidence.',
      },
      {
        q: 'What constitutes fraud that gets someone terminated?',
        a: 'Confirmed self-referrals, paying people to sign up who immediately cancel, using bots, chargebacks on referrals, and identity fraud in the voice interview. Three community guideline violations in 12 months also triggers termination.',
      },
      {
        q: 'What about my tax obligations?',
        a: 'You are an independent contractor responsible for your own taxes. Penworth does not withhold. Every January we send you an annual earnings statement (1099-NEC for US applicants, equivalent elsewhere) covering the prior calendar year.',
      },
      {
        q: 'What\'s the exclusivity agreement?',
        a: 'None. You can be a Guildmember and also promote other products. We ask only that when you recommend Penworth, you represent it honestly.',
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <>
      <section className="border-b border-[#1e2436]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
            Frequently Asked Questions
          </div>
          <h1 className="font-serif text-5xl leading-tight tracking-tight md:text-6xl">
            Honest answers to the <span className="italic text-[#d4af37]">questions that matter</span>.
          </h1>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20">
        {SECTIONS.map((section, i) => (
          <div key={section.heading} className={i > 0 ? 'mt-20' : ''}>
            <h2 className="mb-10 font-serif text-3xl tracking-tight text-[#d4af37]">
              {section.heading}
            </h2>
            <div className="space-y-4">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-lg border border-[#1e2436] bg-[#0f1424] transition hover:border-[#2a3149]"
                >
                  <summary className="flex cursor-pointer items-center justify-between px-6 py-5 text-[#e7e2d4]">
                    <span className="pr-4 font-medium">{item.q}</span>
                    <svg
                      className="flex-shrink-0 text-[#8a8370] transition group-open:rotate-180"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </summary>
                  <div className="border-t border-[#1e2436] px-6 py-5 text-sm leading-relaxed text-[#c9c2b0]">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          Still have questions?
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#c9c2b0]">
          Email <a href="mailto:guild@penworth.ai" className="text-[#d4af37] hover:underline">guild@penworth.ai</a> and a human will reply.
          The best way to understand the Guild, though, is to begin an application.
        </p>
        <div className="mt-10">
          <Link
            href="/guild/apply"
            className="inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-8 py-4 text-base font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
          >
            Apply to Join the Guild →
          </Link>
        </div>
      </section>
    </>
  );
}
