import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Auth from "@/components/Auth";
import {
  hasPendingOfflineAuth,
  readSyntheticSession,
  createOfflineSession,
} from "@/lib/offline-auth";
import { readGuestSession, createGuestSession } from "@/lib/guest-session";
import { getLastKnownAccount } from "@/lib/last-known-account";
import { recordBootAuthOutcome } from "@/lib/offline-readiness";
import { openDB } from "idb";

const SUPABASE_SESSION_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID}-auth-token`;

/**
 * Best-effort lookup of any captured offline_auth entries (refresh-tokens
 * saved on a previous successful online sign-in). Used to auto-resume
 * offline sessions for users who have signed in on this device before but
 * whose Supabase session-storage has been cleared (cache wipe, browser
 * data reset, new tab in private window, etc.).
 */
async function findSingleCapturedOfflineEntry(): Promise<
  { email: string; userId: string } | null
> {
  try {
    const db = await openDB('offline-auth-store', 2);
    if (!db.objectStoreNames.contains('offline_auth')) {
      db.close();
      return null;
    }
    const all = (await db.getAll('offline_auth')) as Array<{
      email: string;
      userId: string;
    }>;
    db.close();
    if (all.length === 1) return { email: all[0].email, userId: all[0].userId };
    return null;
  } catch {
    return null;
  }
}

const Index = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // ── ?guest=1 SHORTCUT ───────────────────────────────────────
        // Honoured even when online so the offline.html fallback link
        // (and any deep-link a user shares) drops straight into a
        // local-only guest session.
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('guest') === '1') {
            createGuestSession();
            setSession({ guest: true });
            navigate('/dashboard', { replace: true });
            return;
          }
        } catch {/* ignore */}

        // ── OFFLINE PATH ─────────────────────────────────────────────
        if (!navigator.onLine) {
          // 1. Real cached Supabase session
          const cachedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
          if (cachedSession) {
            try {
              const parsed = JSON.parse(cachedSession);
              if (parsed && (parsed.user?.id || parsed.access_token)) {
                setSession(parsed);
                navigate('/dashboard', { replace: true });
                return;
              }
            } catch {/* fall through */}
          }

          // 2. Synthetic offline session
          if (readSyntheticSession() || hasPendingOfflineAuth()) {
            setSession({ offline: true });
            navigate('/dashboard', { replace: true });
            return;
          }

          // 3. Captured refresh-token (auto-resume) — single user only.
          const captured = await findSingleCapturedOfflineEntry();
          if (captured) {
            try {
              await createOfflineSession(captured.email, '');
              setSession({ offline: true });
              navigate('/dashboard', { replace: true });
              return;
            } catch {/* show sign-in form */}
          }

          // 4. Guest session
          if (readGuestSession()) {
            recordBootAuthOutcome("guest-session");
            setSession({ guest: true });
            navigate('/dashboard', { replace: true });
            return;
          }

          // 5. Last-known-account — local-only resume after sign-out.
          //    Mints an offline session for the user we last saw sign in
          //    on this device. No tokens, no transmission.
          const lka = getLastKnownAccount();
          if (lka) {
            try {
              await createOfflineSession(lka.email ?? '', '');
              recordBootAuthOutcome("last-known-account-resume", {
                userId: lka.userId,
              });
              setSession({ offline: true });
              navigate('/dashboard', { replace: true });
              return;
            } catch {/* fall through to Auth screen */}
          }

          // No way in offline — render the Auth screen so the user can pick.
          recordBootAuthOutcome("guest-offered");
          setLoading(false);
          return;
        }

        // ── ONLINE PATH (unchanged) ─────────────────────────────────
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth check timeout')), 5000)
        );
        const authPromise = supabase.auth.getSession();
        try {
          const { data: { session }, error } = (await Promise.race([
            authPromise,
            timeoutPromise,
          ])) as any;
          if (!error && session) {
            setSession(session);
            navigate('/dashboard', { replace: true });
            return;
          }
        } catch (authError) {
          console.log('[Auth] Supabase verification failed, checking cache:', authError);
          const cachedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
          if (cachedSession) {
            try {
              const parsed = JSON.parse(cachedSession);
              if (parsed?.access_token) {
                const expiresAt = parsed.expires_at;
                if (expiresAt && expiresAt * 1000 > Date.now()) {
                  setSession(parsed);
                  navigate('/dashboard', { replace: true });
                  return;
                }
              }
            } catch {/* ignore */}
          }
          // Captive-portal / airplane-mode race: navigator.onLine is true
          // but the auth request hung. Fall through to the offline-recovery
          // chain so the user is never stranded on the loading screen.
          if (readSyntheticSession() || hasPendingOfflineAuth()) {
            setSession({ offline: true });
            navigate('/dashboard', { replace: true });
            return;
          }
          const captured = await findSingleCapturedOfflineEntry();
          if (captured) {
            try {
              await createOfflineSession(captured.email, '');
              setSession({ offline: true });
              navigate('/dashboard', { replace: true });
              return;
            } catch {/* show sign-in form */}
          }
          if (readGuestSession()) {
            setSession({ guest: true });
            navigate('/dashboard', { replace: true });
            return;
          }
        }
      } catch (error) {
        console.error('[Auth] Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session) navigate('/dashboard', { replace: true });
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

  if (session) return null;
  return <Auth />;
};

export default Index;
