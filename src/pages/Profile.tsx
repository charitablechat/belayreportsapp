import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Camera, Check, Loader2, Lock, User, X, RefreshCw } from "lucide-react";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { getSessionBackground } from "@/lib/background-manager";
import { triggerHaptic } from "@/lib/haptics";
import { useToast } from "@/hooks/use-toast";
import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
import { SyncDiagnosticsSheet } from "@/components/pwa/SyncDiagnosticsSheet";
import { usePWA } from "@/hooks/usePWA";
import { format } from "date-fns";
import { VersionBadge } from "@/components/VersionBadge";
import { OfflineReadinessCard } from "@/components/diagnostics/OfflineReadinessCard";
import {
  atomicReplaceAvatar,
  safeDeleteOldAvatar,
  type AvatarSupabaseLike,
} from "@/lib/avatar-replace";
import { updateCachedProfileAvatar } from "@/lib/profile-cache";

export default function Profile() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { lastSyncTime, unsyncedCount, isOnline } = usePWA();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState({
    first_name: "",
    last_name: "",
    avatar_url: "",
    acct_number: "",
  });
  const [email, setEmail] = useState("");
  
  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Password validation
  const passwordMinLength = newPassword.length >= 8;
  const passwordMaxLength = newPassword.length <= 72;
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const isPasswordValid = passwordMinLength && passwordMaxLength && passwordsMatch;

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      let authUser = await getUserWithCache();
      
      // Gap 5: Offline / transient-null fallback before redirecting
      if (!authUser) {
        const offlineId = getOfflineUserId();
        if (offlineId) {
          authUser = { id: offlineId } as any;
        } else if (navigator.onLine) {
          navigate("/");
          return;
        } else {
          // Offline with no cached identity – stay on page with stale data
          setLoading(false);
          return;
        }
      }

      setUser(authUser);
      setEmail(authUser.email || "");

      const { data: profileData, error: profileError } = await (supabase as any)
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      if (profileError && profileError.code !== "PGRST116") {
        throw profileError;
      }

      if (profileData) {
        setProfile({
          first_name: (profileData as any).first_name || "",
          last_name: (profileData as any).last_name || "",
          avatar_url: (profileData as any).avatar_url || "",
          acct_number: (profileData as any).acct_number || "",
        });
      }
    } catch (error: any) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Reset the input so re-selecting the same file still fires onChange.
    const inputEl = e.target;

    triggerHaptic('light');

    // Client-side validation (mirrors helper guardrails; short-circuits before
    // any storage call). Helper re-validates as defense-in-depth.
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Please choose an image 5MB or smaller.",
        variant: "destructive",
      });
      if (inputEl) inputEl.value = "";
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Unsupported image type",
        description: "Please use JPEG, PNG, WEBP, or GIF.",
        variant: "destructive",
      });
      if (inputEl) inputEl.value = "";
      return;
    }

    setUploading(true);

    let committed = false;
    let result: Awaited<ReturnType<typeof atomicReplaceAvatar>> | null = null;

    try {
      // Atomic replace: upload new → DB update → (orphan cleanup on DB failure).
      // Old avatar is NOT touched here.
      result = await atomicReplaceAvatar({
        supabase: supabase as unknown as AvatarSupabaseLike,
        userId: user.id,
        oldUrl: profile.avatar_url || null,
        file,
      });

      // DB row is committed — update local UI + profile cache BEFORE any
      // best-effort destructive cleanup of the old avatar.
      committed = true;
      setProfile((prev) => ({ ...prev, avatar_url: result!.publicUrl }));
      try {
        updateCachedProfileAvatar(user.id, result.publicUrl);
      } catch {
        // Non-fatal: cache refresh failure must not roll back the committed avatar.
      }

      triggerHaptic('success');
      toast({
        title: "Avatar Updated",
        description: "Your profile picture has been updated successfully.",
      });
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      triggerHaptic('error');
      const code = error?.code;
      const userMessage =
        code === 'FILE_TOO_LARGE'
          ? 'Image must be 5MB or smaller.'
          : code === 'UNSUPPORTED_TYPE'
          ? 'Unsupported image type.'
          : code === 'UPLOAD_FAILED'
          ? 'Could not upload your new avatar. Your existing avatar is unchanged.'
          : code === 'DB_UPDATE_FAILED'
          ? 'Could not save your new avatar. Your existing avatar is unchanged.'
          : 'Failed to upload avatar. Please try again.';
      toast({
        title: "Upload Failed",
        description: userMessage,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputEl) inputEl.value = "";
    }

    // Best-effort old-avatar cleanup runs AFTER local state + cache are updated.
    // Failure here never surfaces to the user and never rolls back the commit.
    if (committed && result?.oldPathToCleanup) {
      void safeDeleteOldAvatar(
        supabase as unknown as AvatarSupabaseLike,
        result.oldPathToCleanup,
      );
    }
  };


  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;

    triggerHaptic('medium');
    setSaving(true);

    try {
      // Update profile
      const { error: profileError } = await (supabase as any)
        .from("profiles")
        .upsert({
          id: user.id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          avatar_url: profile.avatar_url,
          acct_number: profile.acct_number,
        });

      if (profileError) throw profileError;
      triggerHaptic('success');
      toast({
        title: "Profile Updated",
        description: "Your profile has been saved successfully.",
      });
    } catch (error: any) {
      console.error("Error updating profile:", error);
      triggerHaptic('error');
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (firstName: string, lastName: string): string => {
    const first = firstName?.trim()[0] || "";
    const last = lastName?.trim()[0] || "";
    return (first + last).toUpperCase() || email.substring(0, 2).toUpperCase();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isPasswordValid) {
      triggerHaptic('error');
      return;
    }

    triggerHaptic('medium');
    setChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      
      if (error) throw error;

      triggerHaptic('success');
      toast({
        title: "Password Updated",
        description: "Your password has been changed successfully.",
      });
      
      // Clear password fields
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error("Error updating password:", error);
      triggerHaptic('error');
      toast({
        title: "Password Update Failed",
        description: error.message || "Failed to update password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 z-0">
        <img src={getSessionBackground()} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="relative z-10 min-h-screen bg-gradient-to-b from-background/50 via-background/60 to-background/80 backdrop-blur-sm">
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => goBack(navigate)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <img src={ropeWorksLogo} alt="Rope Works" className="h-10 w-auto object-contain" />
          </div>
          <h1 className="text-xl font-semibold">Profile Settings</h1>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        <OfflineReadinessCard />
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your profile information and avatar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-6">
              {/* Avatar Section */}
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <Avatar className="h-32 w-32">
                    {profile.avatar_url ? (
                      <AvatarImage src={profile.avatar_url} alt="Profile" />
                    ) : null}
                    <AvatarFallback className="bg-primary text-primary-foreground text-3xl">
                      {profile.first_name || profile.last_name ? (
                        getInitials(profile.first_name, profile.last_name)
                      ) : (
                        <User className="h-12 w-12" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <label
                    htmlFor="avatar-upload"
                    className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full cursor-pointer hover:bg-primary/90 transition-colors"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                  </label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAvatarUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Click the camera icon to upload a new avatar (max 5MB)
                </p>
              </div>

              {/* Email (read-only) */}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed from this page
                </p>
              </div>

              {/* First Name */}
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  type="text"
                  value={profile.first_name}
                  onChange={(e) =>
                    setProfile({ ...profile, first_name: e.target.value })
                  }
                  placeholder="Enter your first name"
                  maxLength={50}
                />
              </div>

              {/* Last Name */}
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  type="text"
                  value={profile.last_name}
                  onChange={(e) =>
                    setProfile({ ...profile, last_name: e.target.value })
                  }
                  placeholder="Enter your last name"
                  maxLength={50}
                />
              </div>

              {/* ACCT# */}
              <div className="space-y-2">
                <Label htmlFor="acct_number">ACCT# (Certification Number)</Label>
                <Input
                  id="acct_number"
                  type="text"
                  value={profile.acct_number}
                  onChange={(e) =>
                    setProfile({ ...profile, acct_number: e.target.value })
                  }
                  placeholder="Enter your ACCT certification number"
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground">
                  This will auto-populate in new inspections
                </p>
              </div>

              {/* Save Button */}
              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Security Section */}
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>
              Update your account password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-6">
              {/* New Password */}
              <div className="space-y-2">
                <Label htmlFor="new_password">New Password</Label>
                <Input
                  id="new_password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  maxLength={72}
                />
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirm New Password</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  maxLength={72}
                />
              </div>

              {/* Password Requirements */}
              {(newPassword.length > 0 || confirmPassword.length > 0) && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-muted-foreground">Password Requirements:</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {passwordMinLength ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <X className="h-4 w-4 text-destructive" />
                      )}
                      <span className={passwordMinLength ? "text-green-500" : "text-muted-foreground"}>
                        At least 8 characters
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {confirmPassword.length > 0 ? (
                        passwordsMatch ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <X className="h-4 w-4 text-destructive" />
                        )
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-muted-foreground/50" />
                      )}
                      <span className={
                        confirmPassword.length > 0
                          ? passwordsMatch
                            ? "text-green-500"
                            : "text-destructive"
                          : "text-muted-foreground"
                      }>
                        Passwords match
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Update Password Button */}
              <div className="flex justify-end">
                <Button 
                  type="submit" 
                  disabled={changingPassword || !isPasswordValid}
                >
                  {changingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Data Sync Section */}
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Data Sync</CardTitle>
            </div>
            <CardDescription>
              Manually synchronize your data with the server
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sync Status */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-lg bg-muted/50">
              <div className="space-y-1">
                <p className="text-sm font-medium">Sync Status</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {isOnline ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span>Online</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-destructive" />
                      <span>Offline</span>
                    </>
                  )}
                  {unsyncedCount > 0 && (
                    <span className="text-warning">
                      • {unsyncedCount} item{unsyncedCount > 1 ? 's' : ''} pending
                    </span>
                  )}
                </div>
                {lastSyncTime && (
                  <p className="text-xs text-muted-foreground">
                    Last synced: {format(lastSyncTime, "PPp")}
                  </p>
                )}
              </div>
              <ForceSyncButton variant="default" />
            </div>

            <div className="flex justify-end">
              <SyncDiagnosticsSheet />
            </div>

            <p className="text-xs text-muted-foreground">
              Your data syncs automatically in the background. Use the buttons above to manually trigger a sync or open diagnostics if you believe your data is out of date.
            </p>
          </CardContent>
        </Card>

        {/* Version Badge - Bottom of Profile */}
        <VersionBadge />
      </main>
      </div>
    </div>
  );
}
