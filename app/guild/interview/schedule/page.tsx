import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your Guild Interview',
};

/**
 * Interview landing / scheduling page.
 *
 * Accessed via the email invite link: /interview/schedule?application_id=...
 * Shows the applicant what to expect and a "Begin Interview" button that
 * launches the live interview session.
 */
export default async function InterviewSchedulePage(
  props: {
    searchParams: Promise<{ application_id?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { application_id } = searchParams;

  if (!application_id) {
    redirect('/guild');
  }

  const admin = createAdminClient();
  const { data: app } = await admin
    .from('guild_applications')
    .select('id, full_name, primary_language, application_status')
    .eq('id', application_id!)
    .maybeSingle();

  if (!app) {
    return <NotFound />;
  }

  if (
    !['invited_to_interview', 'interview_scheduled'].includes(app.application_status)
  ) {
    return <AlreadyDone status={app.application_status} />;
  }

  const firstName = app.full_name.split(' ')[0] || app.full_name;

  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        Your Interview
      </div>
      <h1 className="font-serif text-5xl leading-tight tracking-tight">
        Ready when you are, <span className="italic text-[#d4af37]">{firstName}</span>.
      </h1>
      <p className="mt-8 text-lg leading-relaxed text-[#c9c2b0]">
        This is your 10-minute voice interview with The Penworth Guild&apos;s AI interviewer. You
        can begin whenever you&apos;re ready — there&apos;s no scheduled time, no waiting.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Card title="What happens">
          <ul className="space-y-3">
            <li>• The interviewer greets you and asks the first question</li>
            <li>• You hear the question through your speakers or headphones</li>
            <li>• You press to record your answer, then stop when done</li>
            <li>• The interviewer responds and asks the next question</li>
            <li>• This repeats across 7 short topic areas</li>
          </ul>
        </Card>
        <Card title="Before you begin">
          <ul className="space-y-3">
            <li>• Find a quiet space (background noise makes transcription hard)</li>
            <li>• Use a headset or headphones if you can</li>
            <li>• Make sure your microphone works</li>
            <li>• You&apos;ll be prompted to grant microphone access</li>
            <li>• Plan for 10–15 minutes uninterrupted</li>
          </ul>
        </Card>
      </div>

      <div className="mt-12 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-6">
        <div className="flex items-start gap-4">
          <div className="text-2xl">💡</div>
          <div>
            <div className="mb-2 font-serif text-lg text-[#e7e2d4]">Speak naturally</div>
            <p className="text-sm leading-relaxed text-[#c9c2b0]">
              You&apos;re not being tested on knowledge. The Council wants to get to know you —
              your voice, your reasons, your people. Answer the way you would in a real
              conversation. If you need a moment to think, take it.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href={`/guild/interview/live?application_id=${encodeURIComponent(application_id!)}`}
          className="inline-flex items-center gap-3 rounded-md bg-[#d4af37] px-10 py-5 text-lg font-medium text-[#0a0e1a] transition hover:bg-[#e6c14a]"
        >
          Begin Interview →
        </Link>
        <Link
          href="/guild"
          className="inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-transparent px-8 py-5 text-sm text-[#c9c2b0] hover:border-[#3a4259]"
        >
          I&apos;ll come back later
        </Link>
      </div>

      <p className="mt-10 text-center text-xs text-[#6b6452]">
        Your voice interview is recorded and transcribed for the Council&apos;s review. It is
        stored encrypted and never shared outside Penworth.
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1e2436] bg-[#0f1424] p-6">
      <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#d4af37]">
        {title}
      </div>
      <div className="text-sm leading-relaxed text-[#c9c2b0]">{children}</div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-serif text-4xl tracking-tight">Application not found</h1>
      <p className="mt-6 text-sm text-[#8a8370]">
        We couldn&apos;t find an application at this link. The link may have expired.
      </p>
      <Link
        href="/guild"
        className="mt-10 inline-flex items-center gap-2 rounded-md border border-[#2a3149] bg-[#141a2a] px-6 py-3 text-sm text-[#e7e2d4]"
      >
        ← Back to the Guild
      </Link>
    </div>
  );
}

function AlreadyDone({ status }: { status: string }) {
  const messages: Record<string, { title: string; body: string }> = {
    interview_completed: {
      title: 'Your interview is complete',
      body:
        "Thank you for your conversation with our interviewer. The Guild Council is reviewing. You will hear from us within 48 hours.",
    },
    accepted: {
      title: 'You are a Guildmember',
      body: 'Welcome to the Guild. Your dashboard is live.',
    },
    declined: {
      title: 'Application closed',
      body:
        'This application has been reviewed. You are welcome to reapply in 90 days from your application date.',
    },
    auto_declined: {
      title: 'Application closed',
      body:
        'This application has been reviewed. You are welcome to reapply in 90 days from your application date.',
    },
  };
  const msg = messages[status] || { title: 'Application already processed', body: '' };
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-serif text-4xl tracking-tight">{msg.title}</h1>
      <p className="mt-6 text-base text-[#c9c2b0]">{msg.body}</p>
      <Link
        href={status === 'accepted' ? '/guild/dashboard' : '/guild'}
        className="mt-10 inline-flex items-center gap-2 rounded-md bg-[#d4af37] px-6 py-3 text-sm font-medium text-[#0a0e1a] hover:bg-[#e6c14a]"
      >
        {status === 'accepted' ? 'Enter Dashboard' : 'Back to the Guild'}
      </Link>
    </div>
  );
}
