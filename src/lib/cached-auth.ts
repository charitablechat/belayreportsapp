import { supabase } from "@/integrations/supabase/client";
import {
  saveUserMapping,
  clearOfflineAuth,
  readSyntheticSession,
  clearSyntheticSession,
} from "@/lib/offline-auth";
import { isPlaceholderToken, looksLikeJwt } from "@/lib/synthetic-session-guard";
import { safeSetItem } from "@/lib/safe-local-storage";
import { readGuestSession } from "@/lib/guest-session";
import {
  getLastKnownAccount,
  saveLastKnownAccount,
} from "@/lib/last-known-account";
import { requestPersistentStorageOnce } from "@/lib/offline-readiness";

export interface CachedUser {
  id: string;
  email?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// Session-level cache for user data to avoid redundant API calls
let cachedUser: CachedUser | null = null;
let cacheTimestamp: number = 0;
let pendingUserPromise: Promise<CachedUser | null> | null = null;
let authListenerInitialized = false;
const CACHE_TTL = 60000; // 1 minute cache

// Admin status cache - reduces redundant RPC calls
let cachedAdminStatus: boolean | null = null;
let adminCacheTimestamp: number = 0;
let pendingAdminPromise: Promise<boolean> | null = null;
const ADMIN_CACHE_TTL = 120000; // 2 minutes
const SESSION_REFRESH_BUFFER = 300; // P2 FIX: Refresh if within 5 minutes of expiry (matches pre-emptive window)
const AUTH_NETWORK_TIMEOUT = 8000; // 8 seconds max for network auth fetch

/** Supabase auth-token localStorage key — derived from project ref. */
const SUPABASE_SESSION_KEY = `sb-${import.meta.env.VITE_SUPABASE_PROJECT_ID || 'ssgzcgvygnsrqalisshx'}-auth-token`;

// ── C7: Per-user-namespaced admin cache keys ──
const ADMIN_CACHE_PREFIX = 'cached-admin-status:';
const TRUE_SUPER_ADMIN_CACHE_PREFIX = 'cached-true-super-admin:';

export function getAdminCacheKey(userId: string): string {
  return `${ADMIN_CACHE_PREFIX}${userId}`;
}

export function getTrueSuperAdminCacheKey(userId: string): string {
  return `${TRUE_SUPER_ADMIN_CACHE_PREFIX}${userId}`;
}

/** Sweep ALL namespaced admin cache entries (any user). */
export function clearAllAdminCacheKeys(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith(ADMIN_CACHE_PREFIX) ||
          k.startsWith(TRUE_SUPER_ADMIN_CACHE_PREFIX))
      ) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/** Targeted clear for a single user-id. */
export function clearAdminCacheForUser(userId: string): void {
  try {
    localStorage.removeItem(getAdminCacheKey(userId));
    localStorage.removeItem(getTrueSuperAdminCacheKey(userId));
  } catch {
    // ignore
  }
}

// One-time migration: remove legacy unscoped keys (stale by definition)
try {
  localStorage.removeItem('cached-admin-status');
  localStorage.removeItem('cached-true-super-admin');
} catch {
  // ignore (e.g. SSR / restricted storage)
}

// ── H6: Single-flight session refresh + abort-on-signout ──
let pendingRefreshPromise: Promise<Awaited<ReturnType<typeof supabase.auth.refreshSession>> | null> | null = null;
let refreshAborted = false;

/**
 * Coordinated wrapper around `supabase.auth.refreshSession()`.
 * - Concurrent callers share the same in-flight promise (single-flight).
 * - If sign-out flips `refreshAborted` mid-flight, the resolved value is
 *   suppressed so a stale token cannot re-hydrate the session post-signout.
 */
export function refreshSessionSingleFlight() {
  if (pendingRefreshPromise) return pendingRefreshPromise;
  refreshAborted = false;
  pendingRefreshPromise = (async () => {
    try {
      const result = await supabase.auth.refreshSession();
      if (refreshAborted) return null;
      return result;
    } catch (err) {
      if (refreshAborted) return null;
      throw err;
    } finally {
      pendingRefreshPromise = null;
    }
  })();
  return pendingRefreshPromise;
}

/**
 * Sign out while aborting any in-flight refresh so a late refresh cannot
 * re-create the session after `signOut()` clears it. Bounded wait (1s) so a
 * hung refresh can't block sign-out.
 */
export async function signOutWithAbort(): Promise<void> {
  refreshAborted = true;
  if (pendingRefreshPromise) {
    try {
      await Promise.race([
        pendingRefreshPromise,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } catch {
      // ignore — we're tearing down regardless
    }
  }
  try {
    await supabase.auth.signOut();
  } finally {
    refreshAborted = false;
  }
}

/**
 * Detects Navigator LockManager timeout errors from Supabase auth-js.
 * These occur when too many concurrent auth requests compete for the session lock.
 */
function isLockManagerError(error: unknown): boolean {
  const e = error as { message?: unknown; toString?: () => string } | null | undefined;
  const msg =
    (typeof e?.message === 'string' ? e.message : '') ||
    (typeof e?.toString === 'function' ? e.toString() : '') ||
    '';
  return msg.includes('LockManager') || (msg.includes('lock') && msg.includes('timed out'));
}

/**
 * Audit M2: soft invalidation for iOS bfcache restore.
 *
 * Clears in-memory user / admin caches (so the next `getUserWithCache`
 * call re-fetches via Supabase) but does NOT touch persistent storage
 * (no `clearOfflineAuth`, no `clearAllAdminCacheKeys`). Used by the
 * `pageshow` handler when iOS Safari resumes the page from bfcache —
 * the cached identity in memory may correspond to an already-expired
 * JWT, so we make the caches expire and trigger a single-flight
 * refresh. We deliberately keep the persistent offline-auth credentials
 * intact so a user returning from a phone-lock doesn't get bumped to
 * the sign-in screen.
 */
function softInvalidateForBfcacheRestore(): void {
  cachedUser = null;
  cacheTimestamp = 0;
  pendingUserPromise = null;
  cachedAdminStatus = null;
  adminCacheTimestamp = 0;
  pendingAdminPromise = null;
  cachedTrueSuperAdmin = null;
  trueSuperAdminCacheTimestamp = 0;
  pendingTrueSuperAdminPromise = null;
}

/**
 * Audit M2: register the iOS Safari bfcache restore handler exactly once.
 *
 * iOS Safari aggressively serves the page from bfcache on back/forward
 * navigation, tab switch, and after the device wakes from a lock. The
 * page resumes with whatever in-memory state it had when suspended —
 * including a `cachedUser` referencing an access token that has long
 * since expired. We listen for `pageshow` with `event.persisted === true`
 * (the bfcache-restore signal) and:
 *
 *   1. Soft-invalidate in-memory caches so the next call re-fetches.
 *   2. Kick off a single-flight session refresh so the new token is
 *      ready before any pending UI render reads it.
 *
 * Guarded with an idempotent flag — a second `initAuthListener()` call
 * (or HMR) will not double-attach.
 */
let bfcacheListenerInitialized = false;
function initBfcacheListener(): void {
  if (bfcacheListenerInitialized) return;
  if (typeof window === 'undefined') return;
  bfcacheListenerInitialized = true;
  try {
    window.addEventListener('pageshow', (event) => {
      // Only fire on actual bfcache restore. Initial page load also fires
      // pageshow but with `persisted=false`; those don't have a stale cache.
      if (!(event as PageTransitionEvent).persisted) return;
      softInvalidateForBfcacheRestore();
      // Fire-and-forget — we don't want to block the resumed render. If
      // the refresh fails (network), the next `getUserWithCache` call
      // will retry via its own path.
      refreshSessionSingleFlight().catch(() => {
        // ignore — single-flight wrapper already swallows
      });
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[CachedAuth] Failed to attach bfcache listener:', error);
    }
  }
}

/**
 * Initialize auth state change listener (called lazily on first use)
 */
function initAuthListener() {
  if (authListenerInitialized) return;
  authListenerInitialized = true;

  // M2: pageshow handler also lazy-attaches alongside the auth listener so
  // we don't pay the cost on a page that never reads the cache.
  initBfcacheListener();

  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && navigator.onLine) {
        // P1 FIX: Only invalidate cache on genuine sign-out (online).
        // Offline SIGNED_OUT events are often transient token refresh failures.
        invalidateUserCache();
      }
      // C7: When a different user signs in or current user changes, drop any
      // namespaced admin cache entries that don't belong to the new user-id
      // and invalidate in-memory caches so the next read re-fetches fresh.
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        try {
          const newId = session?.user?.id;
          if (newId) {
            const stale: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (
                k &&
                (k.startsWith('cached-admin-status:') ||
                  k.startsWith('cached-true-super-admin:')) &&
                !k.endsWith(`:${newId}`)
              ) {
                stale.push(k);
              }
            }
            stale.forEach((k) => localStorage.removeItem(k));
          }
          // In-memory caches are user-agnostic — wipe them so next call re-fetches
          cachedAdminStatus = null;
          adminCacheTimestamp = 0;
          pendingAdminPromise = null;
          cachedTrueSuperAdmin = null;
          trueSuperAdminCacheTimestamp = 0;
          pendingTrueSuperAdminPromise = null;
        } catch {
          // ignore
        }
      }
      // C4: capture refresh token whenever the auth state changes with a real session.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user?.email && session?.refresh_token) {
          saveUserMapping(session.user.email, session.user.id, session.refresh_token).catch(() => {});
        }
        // Phase 1 — persist a non-secret last-known-account pointer so the
        // device can reopen offline even after explicit sign-out clears
        // tokens. Survives signOut() by design.
        if (session?.user?.id) {
          saveLastKnownAccount({
            userId: session.user.id,
            email: session.user.email ?? null,
            displayName:
              (session.user.user_metadata as { full_name?: string } | undefined)
                ?.full_name ?? null,
          });
          // Best-effort: ask the browser to mark our storage as persistent.
          // Non-blocking; result is recorded in readiness diagnostics.
          void requestPersistentStorageOnce();
          // Phase 2 — warm core shell routes + user data (one-shot per session).
          void (async () => {
            try {
              const { warmShellRoutes } = await import("@/lib/shell-warmup");
              await warmShellRoutes();
            } catch {/* ignore */}
            try {
              const { prefetchAllUserData } = await import("@/lib/prefetch-user-data");
              await prefetchAllUserData({ userId: session.user!.id });
            } catch {/* ignore */}
            try {
              const { prewarmActiveReportPhotos } = await import("@/lib/photo-prewarm");
              await prewarmActiveReportPhotos();
            } catch {/* ignore */}
            // Phase 4–6: if the device has guest-owned local work, migrate
            // it onto this newly-signed-in user. Idempotent — safe to call
            // on every SIGNED_IN; no-op when no guest data exists. Never
            // throws; failure leaves the guest data intact for retry.
            try {
              const { detectGuestDataForClaim, claimGuestData } = await import(
                "@/lib/guest-claim"
              );
              const counts = await detectGuestDataForClaim();
              if (counts.total > 0) {
                await claimGuestData(session.user!.id);
              }
            } catch {/* ignore — telemetry surfaced via guest.claim.failed event */}
          })();
        }
      }
      // C5/C6: Only forward REAL JWTs to the SW. Never the offline placeholder.
      if (
        session?.access_token &&
        !isPlaceholderToken(session.access_token) &&
        'serviceWorker' in navigator &&
        navigator.serviceWorker.controller
      ) {
        navigator.serviceWorker.controller.postMessage({
          type: 'AUTH_TOKEN',
          accessToken: session.access_token,
          expiresAt: session.expires_at
        });
      }
    });
  } catch (error) {
    // Silently handle if auth listener fails to initialize
    if (import.meta.env.DEV) {
      console.warn('[CachedAuth] Failed to initialize auth listener:', error);
    }
  }
}

/**
 * Gets the current user with session-level caching.
 * Uses a single-flight pattern to deduplicate concurrent requests.
 * Falls back to localStorage when offline.
 */
export async function getUserWithCache(): Promise<CachedUser | null> {
  // Initialize auth listener on first use
  initAuthListener();
  
  const now = Date.now();
  
  // 1. FASTEST PATH: Return in-memory cached user if still valid
  if (cachedUser && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedUser;
  }
  
  // 2. FAST PATH: Try localStorage before ANY network call (sync operation)
  // This prevents auth timeouts during background sync
  const storedUser = getCachedUserFromStorage();
  if (storedUser) {
    // Update in-memory cache from localStorage (no network needed)
    cachedUser = storedUser;
    cacheTimestamp = now;
    
    // L9: Removed manual pre-emptive refresh — Supabase v2 handles this via
    // `autoRefreshToken: true` (set in client.ts), which refreshes ~5 min
    // before expiry. `refreshSessionSingleFlight` remains exported for
    // explicit-refresh paths and the sign-out abort machinery.

    // Background refresh: non-blocking network call to keep cache fresh
    // Uses setTimeout to ensure it doesn't block the sync caller
    if (navigator.onLine && !pendingUserPromise) {
      setTimeout(() => refreshUserInBackground(), 0);
    }
    
    return storedUser;
  }
  
  // 3. SLOW PATH: No cached user, must fetch from network
  // If there's already a pending request, wait for it (single-flight pattern)
  if (pendingUserPromise) {
    return pendingUserPromise;
  }
  
  // If offline and no cached user, try last-resort fallback
  if (!navigator.onLine) {
    const offlineId = getOfflineUserId();
    if (offlineId) {
      const fallbackUser: CachedUser = { id: offlineId };
      cachedUser = fallbackUser;
      cacheTimestamp = Date.now();
      return fallbackUser;
    }
    return null;
  }
  
  // Create a new request and store the promise with timeout protection
  pendingUserPromise = (async () => {
    try {
      const authPromise = supabase.auth.getUser();
      const result = await Promise.race([
        authPromise.then(res => ({ user: res.data.user, timedOut: false })),
        new Promise<{ user: null; timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ user: null, timedOut: true }), AUTH_NETWORK_TIMEOUT)
        )
      ]);
      
      if (result.timedOut) {
        console.warn('[CachedAuth] Auth network request timed out');
        return null;
      }
      
      if (result.user) {
        cachedUser = result.user;
        cacheTimestamp = Date.now();
        // Save email-to-userId mapping for future offline logins (fire-and-forget).
        // Note: refresh token is captured separately via the auth state listener.
        if (result.user.email) {
          saveUserMapping(result.user.email, result.user.id).catch(() => {});
        }
      }
      
      return result.user;
    } catch (error: unknown) {
      // LockManager timeout: fall back to localStorage session user
      if (isLockManagerError(error)) {
        console.warn('[CachedAuth] LockManager timeout in getUser — falling back to localStorage');
        const localUser = getCachedUserFromStorage();
        if (localUser) {
          cachedUser = localUser;
          cacheTimestamp = Date.now();
          return localUser;
        }
      }
      console.error('[CachedAuth] Error fetching user:', error);
      return null;
    } finally {
      pendingUserPromise = null;
    }
  })();
  
  return pendingUserPromise;
}

/**
 * Background refresh - keeps cache fresh without blocking callers
 * Uses a separate promise to avoid type conflicts with main flow
 */
let backgroundRefreshInProgress = false;

function refreshUserInBackground() {
  if (backgroundRefreshInProgress || pendingUserPromise) return; // Already refreshing
  
  backgroundRefreshInProgress = true;
  
  (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        cachedUser = user;
        cacheTimestamp = Date.now();
      }
    } catch (error) {
      // Silent fail - we already have a valid cached user
      if (import.meta.env.DEV) {
        console.log('[CachedAuth] Background refresh failed (non-critical):', error);
      }
    } finally {
      backgroundRefreshInProgress = false;
    }
  })();
}

/**
 * Invalidates the user cache - call this on sign-out
 */
export function invalidateUserCache() {
  cachedUser = null;
  cacheTimestamp = 0;
  pendingUserPromise = null;
  // Also invalidate admin cache on user cache invalidation
  invalidateAdminCache();
  // Also invalidate true super admin cache
  cachedTrueSuperAdmin = null;
  trueSuperAdminCacheTimestamp = 0;
  pendingTrueSuperAdminPromise = null;
  // C7: sweep all per-user namespaced admin cache keys on sign-out
  clearAllAdminCacheKeys();
  // Clear offline auth credentials on sign-out (online path)
  clearOfflineAuth().catch(() => {});
}

/**
 * H11: Soft session-state clear used by the OFFLINE sign-out path.
 *
 * Clears in-memory caches and the synthetic session so the UI returns to the
 * sign-in screen, but DOES NOT touch the captured offline_auth refresh-token
 * entry — so the user can sign back in offline immediately.
 *
 * The caller is expected to also call `queueOfflineSignout()` from
 * `offline-auth.ts` to schedule the full cleanup for the next reconnect.
 */
export function clearSessionStateForOfflineSignout(): void {
  cachedUser = null;
  cacheTimestamp = 0;
  pendingUserPromise = null;
  cachedAdminStatus = null;
  adminCacheTimestamp = 0;
  pendingAdminPromise = null;
  cachedTrueSuperAdmin = null;
  trueSuperAdminCacheTimestamp = 0;
  pendingTrueSuperAdminPromise = null;
  // Drop only the synthetic session — keep the offline_auth IDB entry and the
  // cached admin/profile flags in localStorage so the next offline sign-in is
  // instant.
  clearSyntheticSession();
}

/**
 * Gets the admin status with session-level caching.
 * Uses a single-flight pattern to deduplicate concurrent requests.
 * Falls back to localStorage when offline.
 */
export async function getAdminStatusWithCache(): Promise<boolean> {
  const now = Date.now();

  if (cachedAdminStatus !== null && (now - adminCacheTimestamp) < ADMIN_CACHE_TTL) {
    return cachedAdminStatus;
  }

  if (pendingAdminPromise) {
    return pendingAdminPromise;
  }

  // C7: namespaced offline fallback (sync — no network)
  const userId = getOfflineUserId();
  const namespacedKey = userId ? getAdminCacheKey(userId) : null;
  const localCached = namespacedKey ? localStorage.getItem(namespacedKey) : null;

  if (!navigator.onLine && localCached !== null) {
    return localCached === 'true';
  }

  pendingAdminPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_admin_or_above');
      if (error) throw error;

      const status = !!data;
      cachedAdminStatus = status;
      adminCacheTimestamp = Date.now();
      const u = await getUserWithCache();
      const id = u?.id ?? userId;
      if (id) {
        safeSetItem(getAdminCacheKey(id), status.toString(), { scope: 'cached-auth.adminFlag' });
      }

      return status;
    } catch (error) {
      console.warn('[CachedAuth] Error checking admin status:', error);
      return localCached === 'true';
    } finally {
      pendingAdminPromise = null;
    }
  })();

  return pendingAdminPromise;
}

// Backward compatibility alias
export const getSuperAdminStatusWithCache = getAdminStatusWithCache;

/**
 * Invalidates the admin status cache - call this on role changes or sign-out
 */
export function invalidateAdminCache() {
  cachedAdminStatus = null;
  adminCacheTimestamp = 0;
  pendingAdminPromise = null;
}

// Backward compatibility alias
export const invalidateSuperAdminCache = invalidateAdminCache;

// True super admin cache - distinguishes kale (super_admin role) from regular admins
let cachedTrueSuperAdmin: boolean | null = null;
let trueSuperAdminCacheTimestamp: number = 0;
let pendingTrueSuperAdminPromise: Promise<boolean> | null = null;
const TRUE_SUPER_ADMIN_CACHE_TTL = 120000; // 2 minutes

/**
 * Checks if the current user is a TRUE super admin (has 'admin' role in user_roles
 * checked via the is_super_admin RPC — which is the legacy name for the top-level role).
 * This distinguishes the super admin from regular admins who only have the 'admin' role
 * via is_admin_or_above.
 */
export async function getIsTrueSuperAdmin(): Promise<boolean> {
  const now = Date.now();

  if (cachedTrueSuperAdmin !== null && (now - trueSuperAdminCacheTimestamp) < TRUE_SUPER_ADMIN_CACHE_TTL) {
    return cachedTrueSuperAdmin;
  }

  if (pendingTrueSuperAdminPromise) {
    return pendingTrueSuperAdminPromise;
  }

  // C7: namespaced offline fallback (sync)
  const userId = getOfflineUserId();
  const namespacedKey = userId ? getTrueSuperAdminCacheKey(userId) : null;
  const localCached = namespacedKey ? localStorage.getItem(namespacedKey) : null;

  if (!navigator.onLine && localCached !== null) {
    return localCached === 'true';
  }

  pendingTrueSuperAdminPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_super_admin');
      if (error) throw error;

      const status = !!data;
      cachedTrueSuperAdmin = status;
      trueSuperAdminCacheTimestamp = Date.now();
      const u = await getUserWithCache();
      const id = u?.id ?? userId;
      if (id) {
        safeSetItem(getTrueSuperAdminCacheKey(id), status.toString(), { scope: 'cached-auth.trueSuperAdminFlag' });
      }
      return status;
    } catch (error) {
      console.warn('[CachedAuth] Error checking true super admin status:', error);
      return localCached === 'true';
    } finally {
      pendingTrueSuperAdminPromise = null;
    }
  })();

  return pendingTrueSuperAdminPromise;
}

/**
 * Invalidates the true super admin cache
 */
export function invalidateTrueSuperAdminCache() {
  cachedTrueSuperAdmin = null;
  trueSuperAdminCacheTimestamp = 0;
  pendingTrueSuperAdminPromise = null;
}

/**
 * Gets the cached user from localStorage (Supabase session OR synthetic offline session).
 *
 * Read priority:
 *  - Online: Supabase real session key only.
 *  - Offline: Supabase real session if present (and not the placeholder),
 *    otherwise fall back to the dedicated synthetic-session slot.
 *
 * Never returns the placeholder token to network-using callers.
 */
export function getCachedUserFromStorage(): CachedUser | null {
  try {
    const cachedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (cachedSession) {
      const parsed = JSON.parse(cachedSession);
      // C5: refuse to surface a placeholder token from the real key (legacy data).
      if (parsed?.access_token && !isPlaceholderToken(parsed.access_token)) {
        const expiresAt = parsed.expires_at;
        if (navigator.onLine) {
          if (!expiresAt || expiresAt * 1000 > Date.now()) {
            return parsed.user || null;
          }
        } else {
          // Offline: ignore expiry — we only need user identity for IndexedDB.
          return parsed.user || null;
        }
      }
    }

    // Offline fallback: dedicated synthetic session slot.
    // Phase 1: also accept these in lying-online states (captive portal,
    // Supabase outage) — RequireAuth/Index decide whether to call us in
    // that situation; we just return the local identity if it exists.
    const synthetic = readSyntheticSession();
    if (synthetic?.user?.id) {
      return synthetic.user as CachedUser;
    }
    // Last-resort fallbacks (offline-only execution paths):
    if (!navigator.onLine) {
      const guest = readGuestSession();
      if (guest) {
        return { id: guest.id, email: undefined, isGuest: true } as CachedUser;
      }
      const lka = getLastKnownAccount();
      if (lka) {
        return {
          id: lka.userId,
          email: lka.email ?? undefined,
          isOfflineRestored: true,
        } as CachedUser;
      }
    }

    return null;
  } catch (error) {
    console.error('[CachedAuth] Error reading cached session:', error);
    return null;
  }
}

/**
 * Checks if there's a valid cached session
 */
export function hasCachedSession(): boolean {
  return getCachedUserFromStorage() !== null;
}

/**
 * Alias for getCachedUserFromStorage for backward compatibility
 * Used in UI components that need synchronous access to cached user
 */
export const getCachedUser = getCachedUserFromStorage;

/**
 * Emergency fallback: extract userId directly from localStorage session.
 * Used when getUserWithCache() returns null while offline.
 */
export function getOfflineUserId(): string | null {
  try {
    const session = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (session) {
      const parsed = JSON.parse(session);
      if (parsed?.user?.id && !isPlaceholderToken(parsed?.access_token)) {
        return parsed.user.id;
      }
    }
    const synthetic = readSyntheticSession();
    if (synthetic?.user?.id) return synthetic.user.id;
    const guest = readGuestSession();
    if (guest?.id) return guest.id;
    // Phase 1 — last-known-account fallback. Local-only; never transmitted.
    const lka = getLastKnownAccount();
    return lka?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Mode 7C — narrow auth-cache fallback for the autosync drain path.
 *
 * Reads the supabase session from localStorage and returns the cached
 * `CachedUser` only when the embedded JWT has not yet locally expired
 * (with `skewSeconds` pessimism subtracted from `expires_at`). Refuses
 * to surface placeholder/synthetic tokens — those would 401 immediately
 * on the actual sync POST and just churn the retry loop.
 *
 * This is the fast path for the post-online recovery window when
 * `ensureValidSession()` itself is blocked by an unreachable supabase
 * REST endpoint (`Failed to fetch`) — the cached JWT is still good for
 * the next ~60min, so we let supabase be the authority on the actual
 * sync POST. If the token is bad, the POST will 401 and the existing
 * H5-T classifier + atomic-sync retry budget take over from there.
 *
 * @returns The cached user if the JWT's `expires_at` minus `skewSeconds`
 *          is still in the future; null otherwise.
 */
export function getLocallyValidCachedUser(skewSeconds: number = 60): CachedUser | null {
  try {
    const stored = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed?.user?.id) return null;
    if (!parsed?.access_token || isPlaceholderToken(parsed.access_token)) return null;
    if (!looksLikeJwt(parsed.access_token)) return null;
    const expiresAt = parsed?.expires_at;
    if (!expiresAt || typeof expiresAt !== 'number') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAt - skewSeconds <= nowSec) return null;
    return parsed.user as CachedUser;
  } catch {
    return null;
  }
}

/**
 * Offline-aware session check that ignores token expiry.
 * Either a real Supabase session OR a synthetic offline session counts.
 */
export function hasCachedSessionForOffline(): boolean {
  try {
    const cachedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (cachedSession) {
      const parsed = JSON.parse(cachedSession);
      if (parsed?.user?.id && !isPlaceholderToken(parsed?.access_token)) {
        return true;
      }
    }
    if (readSyntheticSession()) return true;
    if (readGuestSession()) return true;
    // Phase 1 — last-known-account is a valid offline identity for local
    // access only (no transmission). Lets returning users reach /dashboard
    // after sign-out + offline relaunch.
    return !!getLastKnownAccount();
  } catch {
    return false;
  }
}

/**
 * Ensures the Supabase client has a valid session before database operations.
 * This is critical for sync operations that rely on RLS policies.
 */
export async function ensureValidSession(): Promise<CachedUser | null> {
  // Initialize auth listener on first use
  initAuthListener();
  
  try {
    // FAST PATH: Check localStorage first — avoid LockManager entirely
    // if we have a token that isn't near expiry
    try {
      const storedSession = localStorage.getItem(SUPABASE_SESSION_KEY);
      if (storedSession) {
        const parsed = JSON.parse(storedSession);
        // C5: never let the placeholder token reach network callers.
        if (isPlaceholderToken(parsed?.access_token)) {
          // Skip the fast path — fall through to the slow path which will
          // attempt a real refresh.
        } else {
          const expiresAt = parsed?.expires_at || 0;
          const now = Math.floor(Date.now() / 1000);
          const timeUntilExpiry = expiresAt - now;
          
          // If token is valid and not within 5-min refresh buffer, skip network call
          if (parsed?.user && timeUntilExpiry > SESSION_REFRESH_BUFFER) {
            cachedUser = parsed.user;
            cacheTimestamp = Date.now();
            return parsed.user;
          }
          
          // Token near expiry but user exists — return user, refresh in background
          if (parsed?.user && timeUntilExpiry > 0) {
            cachedUser = parsed.user;
            cacheTimestamp = Date.now();
            // Non-blocking refresh
            if (navigator.onLine) {
              setTimeout(() => {
                refreshSessionSingleFlight()?.catch?.(() => {});
              }, 0);
            }
            return parsed.user;
          }
          
          // Token expired but user exists AND we're offline — trust it
          if (parsed?.user && !navigator.onLine) {
            cachedUser = parsed.user;
            cacheTimestamp = Date.now();
            return parsed.user;
          }
        }
      }
    } catch {
      // Ignore localStorage parse errors — fall through to slow path
    }
    
    // SLOW PATH: No valid localStorage token — must use Supabase client
    let session;
    let sessionError;
    try {
      const result = await supabase.auth.getSession();
      session = result.data.session;
      sessionError = result.error;
    } catch (lockError: unknown) {
      // LockManager timeout: bypass the lock and read session from localStorage
      if (isLockManagerError(lockError)) {
        console.warn('[CachedAuth] LockManager timeout in getSession — falling back to localStorage');
        const localUser = getCachedUserFromStorage();
        if (localUser) {
          cachedUser = localUser;
          cacheTimestamp = Date.now();
          return localUser;
        }
      }
      throw lockError;
    }
    
    if (sessionError) {
      console.error('[CachedAuth] Session error:', sessionError);
      return null;
    }
    
    // If no session, try refreshing using stored refresh token before giving up
    if (!session) {
      if (navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[CachedAuth] No active session — attempting refresh via stored token');
        }
        try {
          const refreshResult = await refreshSessionSingleFlight();
          const refreshedSession = refreshResult?.data?.session ?? null;
          const refreshError = refreshResult?.error ?? null;
          if (refreshedSession && !refreshError) {
            cachedUser = refreshedSession.user;
            cacheTimestamp = Date.now();
            if (import.meta.env.DEV) {
              console.log('[CachedAuth] Session recovered via refresh token');
            }
            return refreshedSession.user;
          }
        } catch (refreshErr) {
          console.warn('[CachedAuth] Refresh token attempt failed:', refreshErr);
        }
      }
      console.warn('[CachedAuth] No active session for sync');
      return null;
    }
    
    // Check if token needs refresh (within buffer of expiry)
    const expiresAt = session.expires_at || 0;
    const now = Math.floor(Date.now() / 1000);
    const needsRefresh = expiresAt - now < SESSION_REFRESH_BUFFER;
    
    if (needsRefresh) {
      if (import.meta.env.DEV) {
        console.log('[CachedAuth] Session expiring soon, refreshing...', {
          expiresIn: expiresAt - now,
          buffer: SESSION_REFRESH_BUFFER
        });
      }
      
      const refreshResult = await refreshSessionSingleFlight();
      const refreshedSession = refreshResult?.data?.session ?? null;
      const refreshError = refreshResult?.error ?? null;
      
      if (refreshError || !refreshedSession) {
        console.error('[CachedAuth] Failed to refresh session:', refreshError);
        return null;
      }
      
      // C5: refuse to bless a session whose token isn't a real JWT.
      if (!looksLikeJwt(refreshedSession.access_token)) {
        console.warn('[CachedAuth] Refresh returned non-JWT access_token — refusing to validate session');
        return null;
      }

      cachedUser = refreshedSession.user;
      cacheTimestamp = Date.now();
      
      if (import.meta.env.DEV) {
        console.log('[CachedAuth] Session refreshed successfully');
      }
      
      return refreshedSession.user;
    }
    
    // C5: belt-and-suspenders — if the session somehow carries the placeholder
    // token (shouldn't happen at this point, but defense-in-depth), refuse it.
    if (!looksLikeJwt(session.access_token)) {
      console.warn('[CachedAuth] Active session has non-JWT access_token — refusing to validate');
      return null;
    }

    cachedUser = session.user;
    cacheTimestamp = Date.now();
    return session.user;
    
  } catch (error) {
    console.error('[CachedAuth] Error validating session:', error);
    return null;
  }
}
