'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: string;
  logo_url: string;
  subscription_tier: string;
  created_at: string;
}

interface Member {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  created_at: string;
  profiles: {
    email: string;
    full_name: string;
    avatar_url: string;
  };
}

const INDUSTRIES = [
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'education', label: 'Education' },
  { value: 'finance', label: 'Finance' },
  { value: 'legal', label: 'Legal' },
  { value: 'mining', label: 'Mining & Resources' },
  { value: 'government', label: 'Government' },
  { value: 'technology', label: 'Technology' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'general', label: 'General' },
];

const ROLES = [
  { value: 'owner', label: 'Owner', description: 'Full access, can delete organization' },
  { value: 'admin', label: 'Admin', description: 'Manage members and settings' },
  { value: 'editor', label: 'Editor', description: 'Create and edit projects' },
  { value: 'viewer', label: 'Viewer', description: 'View only access' },
];

export default function OrganizationPage() {
  const router = useRouter();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'members' | 'branding'>('general');

  // Form states
  const [orgName, setOrgName] = useState('');
  const [industry, setIndustry] = useState('general');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [isInviting, setIsInviting] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadOrganization();
  }, []);

  const loadOrganization = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    // Get user's organization
    const { data: memberData } = await supabase
      .from('org_members')
      .select(`
        *,
        organizations (*)
      `)
      .eq('user_id', user.id)
      .single();

    if (memberData?.organizations) {
      const orgData = memberData.organizations as Organization;
      setOrg(orgData);
      setOrgName(orgData.name);
      setIndustry(orgData.industry);

      // Load all members
      const { data: membersData } = await supabase
        .from('org_members')
        .select(`
          *,
          profiles (email, full_name, avatar_url)
        `)
        .eq('org_id', orgData.id);

      if (membersData) {
        setMembers(membersData as Member[]);
      }
    }

    setIsLoading(false);
  };

  const saveOrganization = async () => {
    if (!org) return;
    setIsSaving(true);

    const { error } = await supabase
      .from('organizations')
      .update({
        name: orgName,
        industry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', org.id);

    if (error) {
      alert('Failed to save organization');
    } else {
      alert('Organization saved successfully');
      setOrg({ ...org, name: orgName, industry });
    }
    setIsSaving(false);
  };

  const inviteMember = async () => {
    if (!org || !inviteEmail) return;
    setIsInviting(true);

    try {
      // In production, this would send an email invitation
      const response = await fetch('/api/organizations/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: org.id,
          email: inviteEmail,
          role: inviteRole,
        }),
      });

      if (!response.ok) throw new Error('Failed to send invitation');

      alert(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
    } catch (error) {
      alert('Failed to send invitation. Please try again.');
    } finally {
      setIsInviting(false);
    }
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    const { error } = await supabase
      .from('org_members')
      .update({ role: newRole })
      .eq('id', memberId);

    if (!error) {
      setMembers(members.map(m => 
        m.id === memberId ? { ...m, role: newRole as any } : m
      ));
    }
  };

  const removeMember = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the organization?`)) return;

    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('id', memberId);

    if (!error) {
      setMembers(members.filter(m => m.id !== memberId));
    }
  };

  const createOrganization = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const name = prompt('Enter organization name:');
    if (!name) return;

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const { data: newOrg, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name,
        slug,
        industry: 'general',
        subscription_tier: 'free',
      })
      .select()
      .single();

    if (orgError || !newOrg) {
      alert('Failed to create organization');
      return;
    }

    // Add user as owner
    const { error: memberError } = await supabase
      .from('org_members')
      .insert({
        org_id: newOrg.id,
        user_id: user.id,
        role: 'owner',
      });

    if (!memberError) {
      loadOrganization();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-16 border rounded-lg bg-muted/30">
          <div className="text-4xl mb-4">🏢</div>
          <h2 className="text-2xl font-semibold mb-2">No Organization</h2>
          <p className="text-muted-foreground mb-6">
            Create an organization to collaborate with your team
          </p>
          <Button onClick={createOrganization} size="lg">
            Create Organization
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">{org.name}</h1>
      <p className="text-muted-foreground mb-8">
        Manage your organization settings and team members
      </p>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-8">
        {(['general', 'members', 'branding'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6 max-w-lg">
          <div>
            <label className="block text-sm font-medium mb-2">Organization Name</label>
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Your organization name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Industry</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              {INDUSTRIES.map(ind => (
                <option key={ind.value} value={ind.value}>{ind.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              This determines which AI agents and templates are optimized for your organization
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Organization ID</label>
            <Input value={org.id} disabled className="bg-muted font-mono text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Subscription</label>
            <div className="flex items-center gap-4">
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium capitalize">
                {org.subscription_tier}
              </span>
              <Button variant="link" onClick={() => router.push('/billing')}>
                Manage subscription →
              </Button>
            </div>
          </div>

          <Button onClick={saveOrganization} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* Invite Form */}
          <div className="border rounded-lg p-4 bg-card">
            <h3 className="font-medium mb-4">Invite Team Member</h3>
            <div className="flex gap-3">
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                className="flex-1"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
                className="px-3 py-2 border rounded-md bg-background"
              >
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button onClick={inviteMember} disabled={isInviting || !inviteEmail}>
                {isInviting ? 'Sending...' : 'Send Invite'}
              </Button>
            </div>
          </div>

          {/* Members List */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Member</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Joined</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm">
                          {member.profiles?.full_name?.[0] || member.profiles?.email?.[0] || '?'}
                        </div>
                        <div>
                          <p className="font-medium">{member.profiles?.full_name || 'Unknown'}</p>
                          <p className="text-sm text-muted-foreground">{member.profiles?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {member.role === 'owner' ? (
                        <span className="px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                          Owner
                        </span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) => updateMemberRole(member.id, e.target.value)}
                          className="px-2 py-1 border rounded bg-background text-sm"
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(member.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {member.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeMember(member.id, member.profiles?.email || '')}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Role Descriptions */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {ROLES.map(role => (
              <div key={role.value} className="border rounded-lg p-3 bg-card">
                <p className="font-medium capitalize">{role.label}</p>
                <p className="text-xs text-muted-foreground">{role.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branding Tab */}
      {activeTab === 'branding' && (
        <div className="space-y-6 max-w-lg">
          <div>
            <label className="block text-sm font-medium mb-2">Organization Logo</label>
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              {org.logo_url ? (
                <img src={org.logo_url} alt="Logo" className="max-h-20 mx-auto mb-4" />
              ) : (
                <div className="text-4xl mb-4">🏢</div>
              )}
              <Button variant="outline">Upload Logo</Button>
              <p className="text-xs text-muted-foreground mt-2">
                PNG or SVG, max 2MB
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Primary Color</label>
            <div className="flex gap-3">
              <input type="color" defaultValue="#1B3A57" className="w-12 h-10 rounded cursor-pointer" />
              <Input defaultValue="#1B3A57" className="font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Secondary Color</label>
            <div className="flex gap-3">
              <input type="color" defaultValue="#2E5A82" className="w-12 h-10 rounded cursor-pointer" />
              <Input defaultValue="#2E5A82" className="font-mono" />
            </div>
          </div>

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-4">
              Custom branding will be applied to all exported documents and shared projects.
            </p>
            <Button>Save Branding</Button>
          </div>
        </div>
      )}
    </div>
  );
}
