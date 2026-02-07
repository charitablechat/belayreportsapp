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
        // If offline, check cached session immediately without Supabase call
        if (!navigator.onLine) {
          console.log('[Auth] Offline detected, checking cached session');
          const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
          
          if (cachedSession) {
            try {
              const parsed = JSON.parse(cachedSession);
              // Offline: only require a user identity — ignore token expiry
              // The JWT is only needed for server API calls, which won't happen offline
              if (parsed && (parsed.user?.id || parsed.access_token)) {
                console.log('[Auth] Cached session found (offline), navigating to dashboard');
                setSession(parsed);
                navigate("/dashboard", { replace: true });
                return;
              }
            } catch (e) {
              console.error('[Auth] Error parsing cached session:', e);
            }
          }
          
          // No cached session at all while offline
          setLoading(false);
          return;
        }

        // Online: verify with Supabase (with timeout)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Auth check timeout')), 5000)
        );
        
        const authPromise = supabase.auth.getSession();
        
        try {
          const { data: { session }, error } = await Promise.race([
            authPromise,
            timeoutPromise
          ]) as any;

        if (!error && session) {
            setSession(session);
            navigate("/dashboard", { replace: true });
            return;
          }
        } catch (authError) {
          console.log('[Auth] Supabase verification failed or timed out, checking cache:', authError);
          
          // Fallback to cached session only if Supabase request truly failed
          const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
          
          if (cachedSession) {
            try {
              const parsed = JSON.parse(cachedSession);
              if (parsed && parsed.access_token) {
                // Verify the token hasn't expired
                const expiresAt = parsed.expires_at;
                if (expiresAt && expiresAt * 1000 > Date.now()) {
                  setSession(parsed);
                  navigate("/dashboard", { replace: true });
                  return;
                }
              }
            } catch (e) {
              console.error('[Auth] Error parsing cached session:', e);
            }
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
          navigate("/dashboard", { replace: true });
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
