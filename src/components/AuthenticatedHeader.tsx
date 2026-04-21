import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { getUserWithCache } from "@/lib/cached-auth";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";
// UpdateBadge intentionally omitted from header — update affordance lives in the profile dropdown.
import { usePWA } from "@/hooks/usePWA";
import { toast } from "sonner";

const PUBLIC_ROUTES = ["/", "/welcome"];

export function AuthenticatedHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Hide on public routes
  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname);

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      const user = await getUserWithCache();
      setCurrentUser(user);

      if (user && navigator.onLine) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        setUserProfile(profile);
      }
    };

    fetchUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setCurrentUser(session.user);
        }
        if (event === "SIGNED_OUT" && navigator.onLine) {
          setCurrentUser(null);
          setUserProfile(null);
          navigate("/", { replace: true });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Refetch profile when user changes
  useEffect(() => {
    const fetchProfile = async () => {
      if (!currentUser?.id || !navigator.onLine) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", currentUser.id)
        .maybeSingle();
      setUserProfile(profile);
    };
    fetchProfile();
  }, [currentUser?.id]);

  // Check super admin status
  const { data: isSuperAdmin } = useQuery({
    queryKey: ["is-super-admin-global"],
    queryFn: async () => {
      const cachedValue = localStorage.getItem("cached-admin-status");

      if (!navigator.onLine) return cachedValue === "true";

      const user = await getUserWithCache();
      if (!user) {
        // P0 FIX: Do NOT poison cache on transient auth failure
        console.warn('[Header] getUserWithCache returned null — preserving cached admin status');
        return cachedValue === "true";
      }

      try {
        // P3 FIX: Use SECURITY DEFINER RPC instead of direct table query
        const { data, error } = await supabase.rpc('is_admin_or_above');

        if (error) return cachedValue === "true";

        const isAdmin = !!data;
        localStorage.setItem("cached-admin-status", isAdmin.toString());
        return isAdmin;
      } catch {
        return cachedValue === "true";
      }
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
    placeholderData: () => localStorage.getItem("cached-admin-status") === "true",
    enabled: !!currentUser,
  });

  const { unsyncedCount, forceSync } = usePWA();

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      if (navigator.onLine && unsyncedCount > 0) {
        toast.loading('Syncing data before sign-out...', { id: 'sign-out-sync' });
        try {
          await Promise.race([
            forceSync(),
            new Promise(resolve => setTimeout(resolve, 8000)),
          ]);
        } catch (syncError) {
          console.warn('[SignOut] Sync failed, proceeding with sign-out:', syncError);
        } finally {
          toast.dismiss('sign-out-sync');
        }
      }
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      setSigningOut(false);
    }
  };

  // Don't render on public routes or when not authenticated
  if (isPublicRoute || !currentUser) return null;

  // W1: Windows 11 Edge window-controls-overlay — when active, the title-bar
  // area exposes env(titlebar-area-*) safe areas so we can shift our floating
  // header inboard of the native min/max/close buttons. Falls back to the
  // existing top/right offsets on browsers that don't support WCO.
  return (
    <div
      className="fixed z-50 rounded-full bg-white/10 dark:bg-black/20 backdrop-blur-[12px] border border-white/10 transition-transform duration-300 ease-in-out hover:scale-105"
      style={{
        top: 'max(0.75rem, env(titlebar-area-y, 0.75rem))',
        right: 'max(0.75rem, calc(100vw - env(titlebar-area-x, 100vw) - env(titlebar-area-width, 100vw) + 0.75rem))',
        boxShadow: '0 4px 24px -4px rgba(0,0,0,0.12), 0 1px 4px -1px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.05) inset',
      }}
      role="navigation"
      aria-label="User menu"
    >
      <UpdateBadge />
      <UserProfileDropdown
        currentUser={currentUser}
        userProfile={userProfile}
        isSuperAdmin={isSuperAdmin ?? false}
        onSignOut={handleSignOut}
        signingOut={signingOut}
      />
    </div>
  );
}
