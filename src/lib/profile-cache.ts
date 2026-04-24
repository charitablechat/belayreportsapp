import { supabase } from '@/integrations/supabase/client';
import { safeSetItem } from '@/lib/safe-local-storage';

interface CachedProfile {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  acct_number: string | null;
  cachedAt: number;
}

export interface ProfileData {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  acct_number: string | null;
}

const profileCache = new Map<string, CachedProfile>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --- localStorage persistence (last-known-good fallback) ---

function persistProfileToLocalStorage(userId: string, profile: ProfileData): void {
  safeSetItem(
    `cached_profile_${userId}`,
    JSON.stringify(profile),
    { scope: 'profile-cache.persist' },
  );
}

function getPersistedProfile(userId: string): ProfileData | null {
  try {
    const raw = localStorage.getItem(`cached_profile_${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ProfileData;
  } catch {
    return null;
  }
}

// --- Public API ---

export async function getCachedProfile(userId: string): Promise<ProfileData | null> {
  // 1. In-memory cache (fast path)
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return {
      first_name: cached.first_name,
      last_name: cached.last_name,
      avatar_url: cached.avatar_url,
      acct_number: cached.acct_number,
    };
  }

  // 2. Try DB fetch with timeout
  const { data } = await Promise.race([
    supabase
      .from('profiles')
      .select('first_name, last_name, avatar_url, acct_number')
      .eq('id', userId)
      .maybeSingle(),
    new Promise<{ data: null }>(resolve =>
      setTimeout(() => resolve({ data: null }), 5000)
    ),
  ]);

  if (data) {
    // Save to both in-memory and localStorage
    profileCache.set(userId, { ...data, cachedAt: Date.now() });
    persistProfileToLocalStorage(userId, data);
    return data;
  }

  // 3. Fall back to localStorage (offline / timeout)
  return getPersistedProfile(userId);
}

export function clearProfileCache(userId?: string): void {
  if (userId) {
    profileCache.delete(userId);
  } else {
    profileCache.clear();
  }
}
