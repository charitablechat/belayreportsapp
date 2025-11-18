import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TEN_MINUTES_IN_MS = 10 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

export function useSessionTimeout() {
  const [hasShownWarning, setHasShownWarning] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let intervalId: NodeJS.Timeout;

    const checkSessionExpiration = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.expires_at) {
          return;
        }

        const expiresAt = session.expires_at * 1000; // Convert to milliseconds
        const now = Date.now();
        const timeUntilExpiration = expiresAt - now;

        // If less than 10 minutes remaining and we haven't shown the warning
        if (timeUntilExpiration <= TEN_MINUTES_IN_MS && timeUntilExpiration > 0 && !hasShownWarning) {
          const minutesRemaining = Math.floor(timeUntilExpiration / 60000);
          
          toast.warning(
            `Your session will expire in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}`,
            {
              duration: 10000,
              action: {
                label: "Refresh Session",
                onClick: async () => {
                  const { error } = await supabase.auth.refreshSession();
                  if (error) {
                    toast.error("Failed to refresh session");
                  } else {
                    toast.success("Session refreshed successfully");
                    setHasShownWarning(false);
                  }
                },
              },
            }
          );
          
          setHasShownWarning(true);
        }

        // If session has expired
        if (timeUntilExpiration <= 0) {
          toast.error("Your session has expired. Please sign in again.");
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error("Error checking session expiration:", error);
      }
    };

    // Initial check
    checkSessionExpiration();

    // Set up interval to check periodically
    intervalId = setInterval(checkSessionExpiration, CHECK_INTERVAL_MS);

    // Listen for auth state changes to reset warning state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setHasShownWarning(false);
      }
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      subscription.unsubscribe();
    };
  }, [hasShownWarning]);

  return null;
}
