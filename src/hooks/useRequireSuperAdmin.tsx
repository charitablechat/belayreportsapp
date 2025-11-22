import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const useRequireSuperAdmin = () => {
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkSuperAdminStatus = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          navigate("/");
          return;
        }

        // Use server-side RPC function to check super admin status
        const { data: isSuperAdmin, error } = await supabase.rpc('is_super_admin');

        if (error) {
          console.error("Error checking super admin status:", error);
          setIsSuperAdmin(false);
          navigate("/");
          return;
        }

        setIsSuperAdmin(isSuperAdmin);

        if (!isSuperAdmin) {
          toast({
            title: "Access Denied",
            description: "You don't have permission to access this page.",
            variant: "destructive",
          });
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
  }, [navigate, toast]);

  return { isSuperAdmin, loading };
};
