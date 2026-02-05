import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, getSuperAdminStatusWithCache } from "@/lib/cached-auth";

export const useRequireSuperAdmin = () => {
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSuperAdminStatus = async () => {
      try {
        const user = await getUserWithCache();
        
        if (!user) {
          navigate("/");
          return;
        }

        // Use cached super admin status check for performance
        const isSuperAdmin = await getSuperAdminStatusWithCache();

        setIsSuperAdmin(isSuperAdmin);

        if (!isSuperAdmin) {
          navigate("/");
        }
      } catch (error) {
        console.error("Error checking super admin status:", error);
        setIsSuperAdmin(false);
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    checkSuperAdminStatus();
  }, [navigate]);

  return { isSuperAdmin, loading };
};
