import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";

/**
 * Hook that restricts access to users with 'admin' or 'super_admin' roles.
 * Redirects unauthorized users to the dashboard.
 * Role checking is performed via a SECURITY DEFINER database function
 * to prevent client-side tampering.
 */
export const useRequireAdmin = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const user = await getUserWithCache();

        if (!user) {
          navigate("/");
          return;
        }

        // Server-side role check via SECURITY DEFINER RPC
        const { data, error } = await supabase.rpc("is_admin_or_above");
        if (error) throw error;

        const hasAccess = !!data;
        setIsAdmin(hasAccess);

        if (hasAccess) {
          // Additionally check super admin for management controls
          const { data: saData } = await supabase.rpc("is_super_admin");
          setIsSuperAdmin(!!saData);
        }

        if (!hasAccess) {
          navigate("/dashboard");
        }
      } catch (error) {
        console.error("Error checking admin status:", error);
        setIsAdmin(false);
        navigate("/dashboard");
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [navigate]);

  return { isAdmin, isSuperAdmin, loading };
};
