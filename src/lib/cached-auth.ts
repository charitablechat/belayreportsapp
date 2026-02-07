import { supabase } from "@/integrations/supabase/client";

export interface CachedUser {
  id: string;
  email?: string;
  [key: string]: any;
}

// Session-level cache for user data to avoid redundant API calls
let cachedUser: CachedUser | null = null;
let cacheTimestamp: number = 0;
let pendingUserPromise: Promise<CachedUser | null> | null = null;
let authListenerInitialized = false;
const CACHE_TTL = 60000; // 1 minute cache

// Super admin status cache - reduces redundant RPC calls
let cachedSuperAdminStatus: boolean | null = null;
let superAdminCacheTimestamp: number = 0;
let pendingSuperAdminPromise: Promise<boolean> | null = null;
const SUPER_ADMIN_CACHE_TTL = 120000; // 2 minutes
const SESSION_REFRESH_BUFFER = 60; // Refresh if within 60 seconds of expiry
const AUTH_NETWORK_TIMEOUT = 8000; // 8 seconds max for network auth fetch

/**
 * Initialize auth state change listener (called lazily on first use)
 */
function initAuthListener() {
  if (authListenerInitialized) return;
  authListenerInitialized = true;
  
  try {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        invalidateUserCache();
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
  
  // If offline and no cached user, we can't authenticate
  if (!navigator.onLine) {
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
      }
      
      return result.user;
    } catch (error) {
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
  // Also invalidate super admin cache on user cache invalidation
  invalidateSuperAdminCache();
}

/**
 * Gets the super admin status with session-level caching.
 * Uses a single-flight pattern to deduplicate concurrent requests.
 * Falls back to localStorage when offline.
 */
export async function getSuperAdminStatusWithCache(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (cachedSuperAdminStatus !== null && (now - superAdminCacheTimestamp) < SUPER_ADMIN_CACHE_TTL) {
    return cachedSuperAdminStatus;
  }
  
  // Single-flight pattern - dedupe concurrent requests
  if (pendingSuperAdminPromise) {
    return pendingSuperAdminPromise;
  }
  
  // Check localStorage for offline fallback
  const localCached = localStorage.getItem('cached-super-admin-status');
  if (!navigator.onLine && localCached !== null) {
    return localCached === 'true';
  }
  
  pendingSuperAdminPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_super_admin');
      if (error) throw error;
      
      const status = !!data;
      cachedSuperAdminStatus = status;
      superAdminCacheTimestamp = Date.now();
      localStorage.setItem('cached-super-admin-status', status.toString());
      
      return status;
    } catch (error) {
      console.warn('[CachedAuth] Error checking super admin status:', error);
      // Return cached localStorage value on error
      return localCached === 'true';
    } finally {
      pendingSuperAdminPromise = null;
    }
  })();
  
  return pendingSuperAdminPromise;
}

/**
 * Invalidates the super admin status cache - call this on role changes or sign-out
 */
export function invalidateSuperAdminCache() {
  cachedSuperAdminStatus = null;
  superAdminCacheTimestamp = 0;
  pendingSuperAdminPromise = null;
}

/**
 * Gets the cached user from localStorage (Supabase session)
 * Returns null if no valid cached session exists
 */
export function getCachedUserFromStorage(): CachedUser | null {
  try {
    const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
    if (!cachedSession) return null;

    const parsed = JSON.parse(cachedSession);
    if (!parsed || !parsed.access_token) return null;

    // Check if session is expired
    const expiresAt = parsed.expires_at;
    if (!expiresAt || expiresAt * 1000 <= Date.now()) {
      return null;
    }

    // Extract user from session
    if (parsed.user) {
      return parsed.user;
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
 * Offline-aware session check that ignores token expiry.
 * When offline, the JWT is irrelevant (no server calls happen).
 * We only need proof that a user previously authenticated.
 */
export function hasCachedSessionForOffline(): boolean {
  try {
    const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
    if (!cachedSession) return false;
    const parsed = JSON.parse(cachedSession);
    return !!(parsed?.user?.id || parsed?.access_token);
  } catch {
    return false;
  }
}

/**
 * Ensures the Supabase client has a valid session before database operations.
 * This is critical for sync operations that rely on RLS policies.
 * 
 * Unlike getUserWithCache() which reads from localStorage, this actually
 * validates the session with the Supabase client and refreshes if needed.
 * 
 * @returns The current user if session is valid, null otherwise
 */
export async function ensureValidSession(): Promise<CachedUser | null> {
  // Initialize auth listener on first use
  initAuthListener();
  
  try {
    // First, try to get the current session from Supabase client
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[CachedAuth] Session error:', sessionError);
      return null;
    }
    
    // If no session, user needs to log in
    if (!session) {
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
      
      const { data: { session: refreshedSession }, error: refreshError } = 
        await supabase.auth.refreshSession();
      
      if (refreshError || !refreshedSession) {
        console.error('[CachedAuth] Failed to refresh session:', refreshError);
        return null;
      }
      
      // Update in-memory cache with refreshed user
      cachedUser = refreshedSession.user;
      cacheTimestamp = Date.now();
      
      if (import.meta.env.DEV) {
        console.log('[CachedAuth] Session refreshed successfully');
      }
      
      return refreshedSession.user;
    }
    
    // Session is valid - update cache and return user
    cachedUser = session.user;
    cacheTimestamp = Date.now();
    return session.user;
    
  } catch (error) {
    console.error('[CachedAuth] Error validating session:', error);
    return null;
  }
}
