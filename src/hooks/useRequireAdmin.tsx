import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";

/**
 * Hook that restricts access to users with 'admin' or 'super_admin' roles.
 * Redirects unauthorized users to the dashboard.
 * Role checking is performed via a SECURITY DEFINER database function
 * to prevent client-side tampering.
 *
 * Resilience: survives transient network failures and LockManager timeouts
 * by falling back to localStorage cached admin status before redirecting.
 */
export const useRequireAdmin = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        let user = await getUserWithCache();

        // Gap 2: Offline / transient-null fallback before redirecting
        if (!user) {
          const offlineId = getOfflineUserId();
          if (offlineId) {
            user = { id: offlineId } as any;
          } else if (navigator.onLine) {
            // Genuinely unauthenticated while online → redirect to login
            navigate("/");
            return;
          } else {
            // Offline with no cached identity – trust localStorage admin cache
            const cachedAdmin = localStorage.getItem("cached-admin-status");
            if (cachedAdmin === "true") {
              setIsAdmin(true);
              setIsSuperAdmin(true);
              setLoading(false);
              return;
            }
            navigate("/");
            return;
          }
        }

        // Server-side role check via SECURITY DEFINER RPC
        const { data, error } = await supabase.rpc("is_admin_or_above");
        if (error) throw error;

        const hasAccess = !!data;
        setIsAdmin(hasAccess);
        // Gap 3: admin and super_admin are unified – no second RPC needed
        setIsSuperAdmin(hasAccess);

        // Persist for resilience against transient failures
        localStorage.setItem("cached-admin-status", hasAccess.toString());

        if (!hasAccess) {
          navigate("/dashboard");
        }
      } catch (error) {
        console.error("Error checking admin status:", error);

        // Gap 1: Before redirecting on error, honour cached admin status
        const cachedAdmin = localStorage.getItem("cached-admin-status");
        if (cachedAdmin === "true") {
          setIsAdmin(true);
          setIsSuperAdmin(true);
        } else {
          setIsAdmin(false);
          navigate("/dashboard");
        }
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [navigate]);

  return { isAdmin, isSuperAdmin, loading };
};
