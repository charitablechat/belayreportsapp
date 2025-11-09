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

        // Check if user has super_admin role
        const { data: roles, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "super_admin");

        if (error) {
          console.error("Error checking super admin status:", error);
          setIsSuperAdmin(false);
          navigate("/");
          return;
        }

        const hasSuper = roles && roles.length > 0;
        setIsSuperAdmin(hasSuper);

        if (!hasSuper) {
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
