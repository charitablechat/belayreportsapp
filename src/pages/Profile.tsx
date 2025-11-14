import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Camera, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";

export default function Profile() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState({
    first_name: "",
    last_name: "",
    avatar_url: "",
  });
  const [email, setEmail] = useState("");

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      
      if (userError) throw userError;
      if (!authUser) {
        navigate("/");
        return;
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
        });
      }
    } catch (error: any) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please upload a valid image (JPEG, PNG, WebP, or GIF)");
      return;
    }

    setUploading(true);

    try {
      // Delete old avatar if exists
      if (profile.avatar_url) {
        const oldPath = profile.avatar_url.split("/").pop();
        if (oldPath) {
          await supabase.storage
            .from("avatars")
            .remove([`${user.id}/${oldPath}`]);
        }
      }

      // Upload new avatar
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // Update profile with new avatar URL
      const { error: updateError } = await (supabase as any)
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

      if (updateError) throw updateError;

      setProfile({ ...profile, avatar_url: publicUrl });
      toast.success("Avatar updated successfully");
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      toast.error("Failed to upload avatar");
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;

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
        });

      if (profileError) throw profileError;

      toast.success("Profile updated successfully");
    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (firstName: string, lastName: string): string => {
    const first = firstName?.trim()[0] || "";
    const last = lastName?.trim()[0] || "";
    return (first + last).toUpperCase() || email.substring(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <img src={ropeWorksLogo} alt="Rope Works" className="h-10 w-auto object-contain" />
          </div>
          <h1 className="text-xl font-semibold">Profile Settings</h1>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
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
      </main>
    </div>
  );
}
