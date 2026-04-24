/**
 * Background Sync API utilities — DEAD-CODE STRIPPED (S8)
 *
 * Service Worker background sync is permanently DISABLED because the SW cannot
 * access the user's JWT token (RLS would block every write). All sync runs on
 * the main thread via useAutoSync, which has live auth context.
 *
 * The previous "iOS localStorage flag" fallback was dead code — nothing in the
 * codebase ever read those flags to trigger a sync, so writing them only
 * polluted localStorage and misled debuggers. All flag-write paths are now no-ops.
 *
 * The named exports are preserved (no-op) so callers in offline-storage.ts and
 * useAutoSync.tsx continue to compile without churn.
 */

const LEGACY_FLAG_KEYS = [
  'pending-inspection-sync',
  'pending-photo-sync',
  'pending-training-sync',
  'pending-assessment-sync',
] as const;

// One-time cleanup of any legacy flags that previous versions wrote.
let legacyCleanupDone = false;
function cleanupLegacyFlags(): void {
  if (legacyCleanupDone) return;
  legacyCleanupDone = true;
  try {
    for (const key of LEGACY_FLAG_KEYS) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  } catch { /* localStorage may be unavailable */ }
}

// Run cleanup at module load (browser only).
if (typeof window !== 'undefined') {
  try { cleanupLegacyFlags(); } catch { /* noop */ }
}

export async function registerInspectionSync(): Promise<boolean> {
  // No-op: SW sync disabled, main-thread useAutoSync handles sync with auth context
  return false;
}

export async function registerPhotoSync(): Promise<boolean> {
  return false;
}

export async function registerTrainingSync(): Promise<boolean> {
  return false;
}

export async function registerAssessmentSync(): Promise<boolean> {
  return false;
}

export async function registerPeriodicSync(): Promise<boolean> {
  return false;
}

export function isBackgroundSyncSupported(): boolean {
  return false;
}

export function hasPendingSyncs(): boolean {
  return false;
}

/**
 * Kept for back-compat; now also defensively wipes any legacy flag values
 * that pre-S8 builds may have left in localStorage.
 */
export function clearPendingSyncs(): void {
  cleanupLegacyFlags();
}

/**
 * Kept for back-compat; SW sync messaging is disabled so this listener never fires.
 */
export function onSyncComplete(_callback: (data: unknown) => void): () => void {
  return () => { /* noop */ };
}
