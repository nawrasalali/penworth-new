'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BookOpen, Check, X, Loader2, Sparkles, UserPlus } from 'lucide-react';
import Link from 'next/link';

interface InviteData {
  id: string;
  projectTitle: string;
  ownerName: string;
  role: string;
  permissions: {
    can_comment: boolean;
    can_edit: boolean;
    can_export: boolean;
  };
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [user, setUser] = useState<any>(null);
  const [accepted, setAccepted] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    checkAuth();
    fetchInvite();
  }, [token]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
  };

  const fetchInvite = async () => {
    try {
      const res = await fetch(`/api/collaborators/invite?token=${token}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid invitation');
        setIsLoading(false);
        return;
      }

      setInvite(data.invite);
      setIsLoading(false);
    } catch (err) {
      setError('Failed to load invitation');
      setIsLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!user) {
      // Redirect to signup with return URL
      router.push(`/signup?redirect=/invite/${token}`);
      return;
    }

    setIsProcessing(true);
    try {
      const res = await fetch('/api/collaborators/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'accept' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to accept invitation');
        setIsProcessing(false);
        return;
      }

      setAccepted(true);
      
      // Redirect to project after delay
      setTimeout(() => {
        router.push(`/projects/${data.projectId}/editor`);
      }, 2000);
    } catch (err) {
      setError('Failed to accept invitation');
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    setIsProcessing(true);
    try {
      await fetch('/api/collaborators/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'decline' }),
      });

      router.push('/');
    } catch (err) {
      setIsProcessing(false);
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'reviewer':
        return 'You can read and comment on the book';
      case 'editor':
        return 'You can read, comment, and suggest edits';
      case 'co_author':
        return 'You can read, edit, and export the book';
      default:
        return 'You can collaborate on this book';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <X className="h-12 w-12 mx-auto text-red-500 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Invalid Invitation</h2>
          <p className="text-muted-foreground mb-6">
            {error || 'This invitation link is invalid or has expired.'}
          </p>
          <Link href="/">
            <Button>Go to Penworth</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">You're In!</h2>
          <p className="text-muted-foreground mb-4">
            You're now a collaborator on "{invite.projectTitle}"
          </p>
          <p className="text-sm text-muted-foreground">
            Redirecting to the project...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-semibold">
            <BookOpen className="h-5 w-5" />
            Penworth
          </Link>
          {!user && (
            <Link href="/login">
              <Button variant="outline" size="sm">Sign In</Button>
            </Link>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-lg mx-auto px-4 py-16">
        <Card className="p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">You're Invited!</h1>
            <p className="text-muted-foreground">
              <strong>{invite.ownerName}</strong> wants you to collaborate on their book
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 mb-6">
            <h2 className="font-semibold text-lg mb-1">{invite.projectTitle}</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Role: <span className="font-medium">{invite.role.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {getRoleDescription(invite.role)}
            </p>
          </div>

          {/* Permissions */}
          <div className="space-y-2 mb-8">
            <p className="text-sm font-medium">Your permissions:</p>
            <div className="flex flex-wrap gap-2">
              {invite.permissions.can_comment && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                  <Check className="h-3 w-3" /> Comment
                </span>
              )}
              {invite.permissions.can_edit && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                  <Check className="h-3 w-3" /> Edit
                </span>
              )}
              {invite.permissions.can_export && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                  <Check className="h-3 w-3" /> Export
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDecline}
              disabled={isProcessing}
            >
              Decline
            </Button>
            <Button
              className="flex-1"
              onClick={handleAccept}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : user ? (
                'Accept Invitation'
              ) : (
                'Sign Up to Accept'
              )}
            </Button>
          </div>

          {!user && (
            <p className="text-center text-sm text-muted-foreground mt-4">
              Already have an account? <Link href={`/login?redirect=/invite/${token}`} className="text-primary hover:underline">Sign in</Link>
            </p>
          )}
        </Card>

        {/* PLG CTA */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            Want to write your own book?
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Create AI-powered books and publish to Amazon KDP for free.
          </p>
          <Link href="/signup">
            <Button variant="outline" size="sm">
              Start Writing for Free
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
