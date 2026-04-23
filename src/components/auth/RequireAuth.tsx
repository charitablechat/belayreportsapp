import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  getUserWithCache,
  hasCachedSessionForOffline,
  getOfflineUserId,
} from "@/lib/cached-auth";

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * H1: Route guard for authenticated pages.
 *
 * Renders children when an authenticated session exists (online or
 * offline/synthetic). Redirects to "/" when no identity can be resolved.
 * Renders null while resolving to avoid flash redirects.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "ok" | "redirect">(
    "checking"
  );

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const user = await getUserWithCache();
        if (cancelled) return;

        if (user) {
          setStatus("ok");
          return;
        }

        // No user from cache/network — check offline fallback paths
        if (!navigator.onLine) {
          if (hasCachedSessionForOffline() || getOfflineUserId()) {
            setStatus("ok");
            return;
          }
        }

        setStatus("redirect");
        navigate("/", { replace: true });
      } catch (err) {
        if (cancelled) return;
        // Be resilient — only redirect if we truly have nothing cached
        if (hasCachedSessionForOffline() || getOfflineUserId()) {
          setStatus("ok");
        } else {
          setStatus("redirect");
          navigate("/", { replace: true });
        }
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status !== "ok") return null;
  return <>{children}</>;
}

export default RequireAuth;
