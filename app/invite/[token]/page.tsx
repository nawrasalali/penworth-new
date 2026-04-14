'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, Check, X, Loader2 } from 'lucide-react';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    fetchInvitation();
  }, [token]);

  const fetchInvitation = async () => {
    try {
      const supabase = createClient();
      
      // Check if user is logged in
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);

      // Fetch invitation details
      const { data: invite, error } = await supabase
        .from('collaborators')
        .select(`
          *,
          projects (title, description),
          inviter:inviter_id (full_name, avatar_url)
        `)
        .eq('invite_token', token)
        .single();

      if (error || !invite) {
        setError('Invitation not found or has expired');
        setLoading(false);
        return;
      }

      if (invite.status !== 'pending') {
        setError('This invitation has already been ' + (invite.status === 'accepted' ? 'accepted' : 'declined'));
        setLoading(false);
        return;
      }

      setInvitation(invite);
      setLoading(false);
    } catch (err) {
      setError('Failed to load invitation');
      setLoading(false);
    }
  };

  const acceptInvitation = async () => {
    if (!user) {
      // Redirect to signup with return URL
      router.push(`/signup?redirect=/invite/${token}`);
      return;
    }

    setAccepting(true);
    try {
      const supabase = createClient();
      
      const { error } = await supabase
        .from('collaborators')
        .update({
          status: 'accepted',
          invitee_id: user.id,
          accepted_at: new Date().toISOString(),
        })
        .eq('invite_token', token);

      if (error) throw error;

      // Redirect to the project
      router.push(`/projects/${invitation.project_id}`);
    } catch (err) {
      setError('Failed to accept invitation');
      setAccepting(false);
    }
  };

  const declineInvitation = async () => {
    setAccepting(true);
    try {
      const supabase = createClient();
      
      await supabase
        .from('collaborators')
        .update({ status: 'declined' })
        .eq('invite_token', token);

      router.push('/');
    } catch (err) {
      setError('Failed to decline invitation');
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-red-600">Invitation Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>You've Been Invited!</CardTitle>
          <CardDescription>
            {invitation.inviter?.full_name || 'Someone'} has invited you to collaborate on their book
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-gray-100 p-4">
            <h3 className="font-semibold text-lg">{invitation.projects?.title}</h3>
            {invitation.projects?.description && (
              <p className="text-sm text-gray-600 mt-1">{invitation.projects.description}</p>
            )}
            <div className="mt-2 text-sm">
              <span className="text-gray-500">Your role:</span>{' '}
              <span className="font-medium capitalize">{invitation.role}</span>
            </div>
          </div>

          {!user && (
            <div className="text-sm text-center text-gray-600">
              You'll need to create a free account to collaborate
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={declineInvitation}
              disabled={accepting}
            >
              <X className="h-4 w-4 mr-2" />
              Decline
            </Button>
            <Button
              className="flex-1"
              onClick={acceptInvitation}
              disabled={accepting}
            >
              {accepting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {user ? 'Accept' : 'Sign Up & Accept'}
            </Button>
          </div>

          <p className="text-xs text-center text-gray-500">
            After accepting, you can view and {invitation.role === 'editor' ? 'edit' : 'comment on'} the manuscript
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
