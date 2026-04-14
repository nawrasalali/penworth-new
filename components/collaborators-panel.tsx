'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Users, 
  UserPlus, 
  X, 
  Check, 
  Clock, 
  Mail, 
  Loader2,
  ChevronDown,
  Copy
} from 'lucide-react';

interface Collaborator {
  id: string;
  email: string;
  role: string;
  status: string;
  name: string | null;
  avatar: string | null;
  inviteSentAt: string;
  acceptedAt: string | null;
}

interface CollaboratorsPanelProps {
  projectId: string;
  isOwner: boolean;
}

const ROLES = [
  { id: 'reviewer', name: 'Reviewer', description: 'Can read and comment' },
  { id: 'editor', name: 'Editor', description: 'Can read, comment, and suggest edits' },
  { id: 'co_author', name: 'Co-Author', description: 'Full edit and export access' },
];

export function CollaboratorsPanel({ projectId, isOwner }: CollaboratorsPanelProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('reviewer');
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchCollaborators();
  }, [projectId]);

  const fetchCollaborators = async () => {
    try {
      const res = await fetch(`/api/collaborators?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setCollaborators(data.collaborators);
      }
    } catch (err) {
      console.error('Failed to fetch collaborators:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setError(null);
    setInviteUrl(null);

    try {
      const res = await fetch('/api/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to send invite');
        setIsInviting(false);
        return;
      }

      setInviteUrl(data.collaborator.inviteUrl);
      setInviteEmail('');
      fetchCollaborators();
    } catch (err) {
      setError('Failed to send invite');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemove = async (collaboratorId: string) => {
    if (!confirm('Remove this collaborator?')) return;

    try {
      await fetch(`/api/collaborators?id=${collaboratorId}`, {
        method: 'DELETE',
      });
      fetchCollaborators();
    } catch (err) {
      console.error('Failed to remove collaborator:', err);
    }
  };

  const copyInviteUrl = () => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs">
            <Clock className="h-3 w-3" /> Pending
          </span>
        );
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">
            <Check className="h-3 w-3" /> Active
          </span>
        );
      case 'declined':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-800 rounded text-xs">
            <X className="h-3 w-3" /> Declined
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Collaborators</h3>
          {collaborators.length > 0 && (
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
              {collaborators.length}
            </span>
          )}
        </div>
        {isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInviteForm(!showInviteForm)}
          >
            <UserPlus className="h-4 w-4 mr-1" />
            Invite
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInviteForm && isOwner && (
        <form onSubmit={handleInvite} className="mb-4 p-3 bg-muted/50 rounded-lg">
          <div className="flex gap-2 mb-2">
            <Input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm bg-background"
            >
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {ROLES.find(r => r.id === inviteRole)?.description}
            </p>
            <Button type="submit" size="sm" disabled={isInviting || !inviteEmail.trim()}>
              {isInviting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-1" />
                  Send Invite
                </>
              )}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-red-600 mt-2">{error}</p>
          )}
          {inviteUrl && (
            <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
              <p className="text-green-800 mb-1">✓ Invite sent! Share this link:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteUrl}
                  readOnly
                  className="flex-1 px-2 py-1 bg-white border rounded text-xs"
                />
                <Button type="button" size="sm" variant="outline" onClick={copyInviteUrl}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </form>
      )}

      {/* Collaborators List */}
      {isLoading ? (
        <div className="text-center py-4">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : collaborators.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No collaborators yet. {isOwner ? 'Invite someone to get started!' : ''}
        </p>
      ) : (
        <div className="space-y-2">
          {collaborators.map((collab) => (
            <div
              key={collab.id}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                  {collab.name?.[0] || collab.email[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {collab.name || collab.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {collab.role.replace('_', ' ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(collab.status)}
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(collab.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CollaboratorsPanel;
