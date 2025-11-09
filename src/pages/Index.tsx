import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Auth from "@/components/Auth";

const Index = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // First check localStorage for cached session (works offline)
        const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
        
        if (cachedSession) {
          // Parse cached session
          try {
            const parsed = JSON.parse(cachedSession);
            if (parsed && parsed.access_token) {
              // We have a cached session, navigate to dashboard
              setSession(parsed);
              setLoading(false);
              navigate("/dashboard");
              return;
            }
          } catch (e) {
            console.error('[Auth] Error parsing cached session:', e);
          }
        }

        // If online, verify with Supabase
        if (navigator.onLine) {
          const { data: { session } } = await supabase.auth.getSession();
          setSession(session);
          if (session) {
            navigate("/dashboard");
          }
        }
      } catch (error) {
        console.error('[Auth] Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) {
          navigate("/dashboard");
        }
      }
    );

    checkAuth();

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (session) {
    return null; // Will redirect to dashboard
  }

  return <Auth />;
};

export default Index;
