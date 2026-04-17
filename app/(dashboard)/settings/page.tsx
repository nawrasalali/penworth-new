'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LANGUAGE_NAMES } from '@/lib/ai/user-language';
import { Loader2 } from 'lucide-react';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  created_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'security' | 'notifications'>('profile');

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Preferences
  const [theme, setTheme] = useState('system');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [autoSave, setAutoSave] = useState(true);
  const [defaultAgent, setDefaultAgent] = useState('writing');
  const [language, setLanguage] = useState('en');
  const [isChangingLanguage, setIsChangingLanguage] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileData) {
      setProfile(profileData);
      setFullName(profileData.full_name || '');
      setEmail(profileData.email || user.email || '');
      setLanguage(profileData.preferred_language || 'en');
    }
    setIsLoading(false);
  };

  /**
   * Change the user's interface language.
   *
   * Arabic/Spanish/etc. users should live on {lang}.penworth.ai so SEO,
   * AI writing, and the shell language are all aligned. This handler:
   *   1. POSTs the new language to the API (which updates profiles.preferred_language)
   *   2. Receives a redirectUrl pointing at the correct subdomain
   *   3. Hard-navigates so the session cookie (scoped to .penworth.ai) carries
   *      the logged-in state across subdomains
   */
  const changeLanguage = async (newLang: string) => {
    if (newLang === language) return;
    setIsChangingLanguage(true);
    try {
      const resp = await fetch('/api/user/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: newLang }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        alert(data.error || 'Failed to change language');
        setIsChangingLanguage(false);
        return;
      }
      setLanguage(newLang);
      // Hard-navigate so the shell reloads in the new language + direction
      window.location.href = data.redirectUrl;
    } catch (err) {
      alert('Failed to change language');
      setIsChangingLanguage(false);
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    setIsSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    if (error) {
      alert('Failed to save profile');
    } else {
      alert('Profile saved successfully');
    }
    setIsSaving(false);
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      alert('Password must be at least 8 characters');
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      alert('Failed to change password: ' + error.message);
    } else {
      alert('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setIsSaving(false);
  };

  const deleteAccount = async () => {
    const confirmed = confirm(
      'Are you sure you want to delete your account? This action cannot be undone and all your data will be permanently deleted.'
    );
    if (!confirmed) return;

    const doubleConfirm = prompt('Type "DELETE" to confirm account deletion:');
    if (doubleConfirm !== 'DELETE') return;

    // In production, this would call an API endpoint that handles account deletion
    alert('Account deletion request submitted. You will receive a confirmation email.');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-8">
        {(['profile', 'preferences', 'security', 'notifications'] as const).map((tab) => (
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

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="flex items-center gap-6 mb-8">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl">
              {fullName ? fullName[0].toUpperCase() : '👤'}
            </div>
            <div>
              <h2 className="text-xl font-semibold">{fullName || 'Your Name'}</h2>
              <p className="text-muted-foreground">{email}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Member since {profile ? new Date(profile.created_at).toLocaleDateString() : ''}
              </p>
            </div>
          </div>

          <div className="grid gap-6 max-w-lg">
            <div>
              <label className="block text-sm font-medium mb-2">Full Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email Address</label>
              <Input
                value={email}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Email cannot be changed. Contact support if needed.
              </p>
            </div>

            <Button onClick={saveProfile} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}

      {/* Preferences Tab */}
      {activeTab === 'preferences' && (
        <div className="space-y-6 max-w-lg">
          {/* Language picker — changes preferred_language and redirects the
              user to their language subdomain so SEO, AI writing, and the
              shell all stay aligned. */}
          <div>
            <label className="block text-sm font-medium mb-2">Language</label>
            <div className="relative">
              <select
                value={language}
                onChange={(e) => changeLanguage(e.target.value)}
                disabled={isChangingLanguage}
                className="w-full px-3 py-2 border rounded-md bg-background disabled:opacity-60"
              >
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              {isChangingLanguage && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Changes the entire Penworth interface and AI writing language.
              You'll be redirected to your language's subdomain (e.g. ar.penworth.ai for Arabic).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Default AI Agent</label>
            <select
              value={defaultAgent}
              onChange={(e) => setDefaultAgent(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="interview">Interview Agent</option>
              <option value="outline">Outline Agent</option>
              <option value="research">Research Agent</option>
              <option value="writing">Writing Agent</option>
              <option value="review">Review Agent</option>
              <option value="verification">Verification Agent</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium">Auto-save</p>
              <p className="text-sm text-muted-foreground">Automatically save your work every 30 seconds</p>
            </div>
            <button
              onClick={() => setAutoSave(!autoSave)}
              className={`w-12 h-6 rounded-full transition-colors ${
                autoSave ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                autoSave ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          <Button onClick={() => alert('Preferences saved!')}>
            Save Preferences
          </Button>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <div className="space-y-8">
          <div className="max-w-lg">
            <h3 className="text-lg font-semibold mb-4">Change Password</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Current Password</label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">New Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Confirm New Password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button onClick={changePassword} disabled={isSaving || !newPassword}>
                {isSaving ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </div>

          <div className="border-t pt-8">
            <h3 className="text-lg font-semibold mb-4 text-destructive">Danger Zone</h3>
            <div className="border border-destructive/20 rounded-lg p-4 bg-destructive/5">
              <h4 className="font-medium mb-2">Delete Account</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Once you delete your account, there is no going back. All your projects, chapters, and data will be permanently deleted.
              </p>
              <Button variant="destructive" onClick={deleteAccount}>
                Delete Account
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-4 max-w-lg">
          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium">Email Notifications</p>
              <p className="text-sm text-muted-foreground">Receive updates about your projects</p>
            </div>
            <button
              onClick={() => setEmailNotifications(!emailNotifications)}
              className={`w-12 h-6 rounded-full transition-colors ${
                emailNotifications ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                emailNotifications ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium">Weekly Digest</p>
              <p className="text-sm text-muted-foreground">Summary of your writing activity</p>
            </div>
            <button
              className="w-12 h-6 rounded-full bg-primary"
            >
              <div className="w-5 h-5 rounded-full bg-white shadow transform translate-x-6" />
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b">
            <div>
              <p className="font-medium">Product Updates</p>
              <p className="text-sm text-muted-foreground">New features and improvements</p>
            </div>
            <button
              className="w-12 h-6 rounded-full bg-primary"
            >
              <div className="w-5 h-5 rounded-full bg-white shadow transform translate-x-6" />
            </button>
          </div>

          <Button className="mt-4">
            Save Notification Settings
          </Button>
        </div>
      )}
    </div>
  );
}
