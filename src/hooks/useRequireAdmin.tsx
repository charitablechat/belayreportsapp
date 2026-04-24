import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  getUserWithCache,
  getOfflineUserId,
  getAdminCacheKey,
} from "@/lib/cached-auth";
import { safeSetItem } from "@/lib/safe-local-storage";

/**
 * Hook that restricts access to users with 'admin' or 'super_admin' roles.
 * Redirects unauthorized users to the dashboard.
 * Role checking is performed via a SECURITY DEFINER database function
 * to prevent client-side tampering.
 *
 * Resilience: survives transient network failures and LockManager timeouts
 * by falling back to per-user-namespaced cached admin status before redirecting.
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
            navigate("/");
            return;
          } else {
            // Offline with no cached identity – trust namespaced localStorage admin cache
            // (only if we can locate a user-id; otherwise redirect)
            const fallbackId = getOfflineUserId();
            const cachedAdmin = fallbackId
              ? localStorage.getItem(getAdminCacheKey(fallbackId))
              : null;
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
        // admin and super_admin are unified – no second RPC needed
        setIsSuperAdmin(hasAccess);

        // Persist for resilience against transient failures (namespaced)
        if (user?.id) {
          safeSetItem(getAdminCacheKey(user.id), hasAccess.toString(), { scope: 'useRequireAdmin.cache' });
        }

        if (!hasAccess) {
          navigate("/dashboard");
        }
      } catch (error) {
        console.error("Error checking admin status:", error);

        // Gap 1: Before redirecting on error, honour namespaced cached admin status
        const offlineId = getOfflineUserId();
        const cachedAdmin = offlineId
          ? localStorage.getItem(getAdminCacheKey(offlineId))
          : null;
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
