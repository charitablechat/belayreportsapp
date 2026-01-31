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
  
  // Create a new request and store the promise
  pendingUserPromise = (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        cachedUser = user;
        cacheTimestamp = Date.now();
      }
      
      return user;
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
