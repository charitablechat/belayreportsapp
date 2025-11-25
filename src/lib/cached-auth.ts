import { supabase } from "@/integrations/supabase/client";

export interface CachedUser {
  id: string;
  email?: string;
  [key: string]: any;
}

/**
 * Gets the current user, preferring online auth but falling back to cached session
 * This ensures authentication works even when offline
 */
export async function getUserWithCache(): Promise<CachedUser | null> {
  try {
    // Try to get user from Supabase (works online)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return user;
  } catch (error) {
    // Supabase call failed, fall through to cached session
  }

  // Fall back to cached session from localStorage
  return getCachedUser();
}

/**
 * Gets the cached user from localStorage
 * Returns null if no valid cached session exists
 */
export function getCachedUser(): CachedUser | null {
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
  return getCachedUser() !== null;
}
