import { ReferralDashboard } from '@/components/dashboard/ReferralDashboard';

export default function ReferralsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Referrals</h1>
        <p className="text-gray-500 mt-1">
          Invite friends and earn credits when they complete their first book
        </p>
      </div>

      <ReferralDashboard />
    </div>
  );
}
