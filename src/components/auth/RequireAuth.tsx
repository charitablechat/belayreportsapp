import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getUserWithCache,
  hasCachedSessionForOffline,
  getOfflineUserId,
} from "@/lib/cached-auth";
import { useAuthState } from "@/hooks/useAuthState";
import {
  isAuthFsmEnabled,
  isAuthenticated,
  transition,
} from "@/lib/auth-state-machine";
import {
  isOfflineWindowExpiringSoon,
  getOfflineWindowRemainingMs,
} from "@/lib/offline-auth";

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * H1: Route guard for authenticated pages.
 *
 * Phase 2: when the auth state machine is enabled (default), reads from the
 * FSM directly so transitions (offline→online reconcile, sign-out) are
 * reflected without re-polling localStorage. Falls back to the legacy
 * cached-auth probe when `localStorage.AUTH_FSM === "0"`.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const navigate = useNavigate();
  const fsmEnabled = isAuthFsmEnabled();
  const fsmSnapshot = useAuthState();
  const [legacyStatus, setLegacyStatus] = useState<
    "checking" | "ok" | "redirect"
  >("checking");

  // ── FSM PATH ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fsmEnabled) return;

    // While BOOTING, do nothing — render null so we don't flash-redirect.
    if (fsmSnapshot.state === "BOOTING") return;

    if (isAuthenticated(fsmSnapshot)) return;

    if (fsmSnapshot.state === "TRANSITIONING") return;

    // UNAUTHENTICATED — but double-check offline fallbacks before redirecting,
    // because the FSM seed runs before React mounts and a slow first read of
    // IndexedDB credentials might not have promoted us yet.
    if (
      !navigator.onLine &&
      (hasCachedSessionForOffline() || getOfflineUserId())
    ) {
      // Promote the FSM so we don't keep redirecting.
      transition({
        to: "OFFLINE_AUTHENTICATED",
        reason: "RequireAuth:offline-fallback",
        userId: getOfflineUserId(),
      });
      return;
    }

    navigate("/", { replace: true });
  }, [fsmEnabled, fsmSnapshot, navigate]);

  // ── LEGACY PATH (feature flag off) ───────────────────────────────────
  useEffect(() => {
    if (fsmEnabled) return;
    let cancelled = false;

    const check = async () => {
      try {
        const user = await getUserWithCache();
        if (cancelled) return;

        if (user) {
          setLegacyStatus("ok");
          return;
        }

        if (!navigator.onLine) {
          if (hasCachedSessionForOffline() || getOfflineUserId()) {
            setLegacyStatus("ok");
            return;
          }
        }

        setLegacyStatus("redirect");
        navigate("/", { replace: true });
      } catch {
        if (cancelled) return;
        if (hasCachedSessionForOffline() || getOfflineUserId()) {
          setLegacyStatus("ok");
        } else {
          setLegacyStatus("redirect");
          navigate("/", { replace: true });
        }
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [fsmEnabled, navigate]);

  if (fsmEnabled) {
    if (fsmSnapshot.state === "BOOTING" || fsmSnapshot.state === "TRANSITIONING") {
      return null;
    }
    if (!isAuthenticated(fsmSnapshot)) return null;
    return <>{children}</>;
  }

  if (legacyStatus !== "ok") return null;
  return <>{children}</>;
}

export default RequireAuth;
