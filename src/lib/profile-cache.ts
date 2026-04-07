import { supabase } from '@/integrations/supabase/client';

interface CachedProfile {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  cachedAt: number;
}

const profileCache = new Map<string, CachedProfile>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedProfile(userId: string): Promise<{
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
} | null> {
  const cached = profileCache.get(userId);
  
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return {
      first_name: cached.first_name,
      last_name: cached.last_name,
      avatar_url: cached.avatar_url,
    };
  }

  const { data } = await Promise.race([
    supabase
      .from('profiles')
      .select('first_name, last_name, avatar_url')
      .eq('id', userId)
      .maybeSingle(),
    new Promise<{ data: null }>(resolve =>
      setTimeout(() => resolve({ data: null }), 5000)
    ),
  ]);

  if (data) {
    profileCache.set(userId, { ...data, cachedAt: Date.now() });
  }

  return data;
}

export function clearProfileCache(userId?: string): void {
  if (userId) {
    profileCache.delete(userId);
  } else {
    profileCache.clear();
  }
}
