import { requireAdminRole } from '@/lib/admin/require-admin-role';
import { createServiceClient } from '@/lib/supabase/service';
import { ALLOWED_CATEGORIES } from '@/lib/admin/recipients-validation';
import Link from 'next/link';
import { ArrowLeft, Settings } from 'lucide-react';
import RecipientsClient from './RecipientsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * /admin/command-center/settings/recipients
 *
 * Super-admin only. Non-super-admins get 404 via requireAdminRole.
 *
 * The page is a server component that renders the initial list and
 * delegates all interactivity (add/edit/deactivate) to a client
 * component. The client re-queries via router.refresh() after each
 * successful mutation so the list stays current without a full reload.
 */
export default async function RecipientsSettingsPage() {
  await requireAdminRole('super_admin');

  const admin = createServiceClient();
  const { data: recipients } = await admin
    .from('alert_recipients')
    .select(
      'id, email, full_name, receives_p0, receives_p1, receives_p2, categories, quiet_hours_start, quiet_hours_end, timezone, active, created_at',
    )
    .order('active', { ascending: false })
    .order('email', { ascending: true });

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          href="/admin/command-center"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Command Center
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Command Center · Settings
          </span>
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Alert recipients</h1>
        <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
          Who gets paged when an alert fires. Severity + category filters apply per
          recipient. Quiet hours suppress delivery during the specified window in the
          recipient&apos;s timezone.
        </p>
      </div>

      <RecipientsClient
        initialRecipients={recipients ?? []}
        allowedCategories={ALLOWED_CATEGORIES as unknown as readonly string[]}
      />
    </div>
  );
}
