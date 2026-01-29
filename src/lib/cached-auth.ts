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
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Gets the current user with session-level caching.
 * Uses a single-flight pattern to deduplicate concurrent requests.
 * Falls back to localStorage when offline.
 */
export async function getUserWithCache(): Promise<CachedUser | null> {
  const now = Date.now();
  
  // Return cached user if still valid
  if (cachedUser && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedUser;
  }
  
  // If there's already a pending request, wait for it (single-flight pattern)
  if (pendingUserPromise) {
    return pendingUserPromise;
  }
  
  // If offline, try localStorage fallback
  if (!navigator.onLine) {
    return getCachedUserFromStorage();
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
      // Supabase call failed, fall through to cached session
      console.error('[CachedAuth] Error fetching user:', error);
      return getCachedUserFromStorage();
    } finally {
      pendingUserPromise = null;
    }
  })();
  
  return pendingUserPromise;
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

// Listen for auth state changes to invalidate cache
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    invalidateUserCache();
  }
});
