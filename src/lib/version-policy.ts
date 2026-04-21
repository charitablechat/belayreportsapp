/**
 * Version policy — fetches min/recommended version from app_version_policy
 * table and broadcasts to subscribers. Used by MinVersionEnforcer.
 */
import { supabase } from '@/integrations/supabase/client';
import { APP_VERSION } from './attestation';
import { stripSuffix } from './version-check';

export interface VersionPolicy {
  min_required_version: string | null;
  recommended_version: string | null;
  enforce_hard_reload: boolean;
  message: string | null;
  updated_at: string;
}

const POLL_MS = 5 * 60 * 1000;

let cached: VersionPolicy | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(p: VersionPolicy | null) => void>();

export function getCachedPolicy(): VersionPolicy | null {
  return cached;
}

/**
 * True when the local APP_VERSION is older than min_required_version.
 * If no policy or no min set, returns false (no enforcement).
 */
export function isBelowMinimum(policy: VersionPolicy | null): boolean {
  if (!policy?.min_required_version) return false;
  if (!APP_VERSION || APP_VERSION === 'unknown') return false;
  const local = stripSuffix(APP_VERSION);
  const minV = stripSuffix(policy.min_required_version);
  if (local === minV) return false;
  const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const [cMaj = 0, cMin = 0, cPatch = 0] = parse(local);
  const [mMaj = 0, mMin = 0, mPatch = 0] = parse(minV);
  if (mMaj > cMaj) return true;
  if (mMaj === cMaj && mMin > cMin) return true;
  if (mMaj === cMaj && mMin === cMin && mPatch > cPatch) return true;
  return false;
}

async function fetchPolicy(): Promise<VersionPolicy | null> {
  try {
    const { data, error } = await supabase
      .from('app_version_policy')
      .select('min_required_version, recommended_version, enforce_hard_reload, message, updated_at')
      .eq('id', 1)
      .maybeSingle();
    if (error) return cached;
    return (data as VersionPolicy) || null;
  } catch {
    return cached;
  }
}

async function poll() {
  const next = await fetchPolicy();
  cached = next;
  listeners.forEach((l) => {
    try { l(next); } catch { /* ignore */ }
  });
}

export function subscribeVersionPolicy(listener: (p: VersionPolicy | null) => void): () => void {
  listeners.add(listener);
  if (cached) {
    try { listener(cached); } catch { /* ignore */ }
  }
  if (!intervalId) {
    void poll();
    intervalId = setInterval(() => void poll(), POLL_MS);
  }
  return () => listeners.delete(listener);
}

export async function refreshPolicy(): Promise<VersionPolicy | null> {
  await poll();
  return cached;
}
