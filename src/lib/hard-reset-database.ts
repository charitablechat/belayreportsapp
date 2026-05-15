/**
 * Hard reset of the offline database + service workers.
 *
 * Last-resort recovery for the "Local data unreadable" wedge in
 * useUnsyncedPhotos / sync pipeline, where the IndexedDB handle is locked
 * (often by another tab or a wedged SW) and no amount of RECOVER STORAGE
 * unsticks it.
 *
 * Behavior:
 *  - Unregisters every Service Worker under this origin.
 *  - Deletes every known offline IndexedDB database.
 *  - Hard-reloads the page.
 *
 * Preserves:
 *  - localStorage (so the Supabase auth session survives — the user stays
 *    signed in after the reload).
 *
 * Clears:
 *  - sessionStorage (so quarantined-item counters and other per-session
 *    state reset to zero on reload).
 */

import { stopDrainMode } from './drain-mode';

/**
 * Freeze the app: set the global reset flag and stop the drain-mode loop
 * so useAutoSync skips every cycle, then drop SW caches so an in-flight
 * fetch can't repopulate IDB before the reload lands.
 */
async function freezeApp(): Promise<void> {
  try {
    (window as any).__RW_RESETTING = true;
  } catch { /* ignore */ }
  try {
    await stopDrainMode('reset' as any);
  } catch (e) {
    console.warn('[HardReset] stopDrainMode failed:', e);
  }
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
    }
  } catch (e) {
    console.warn('[HardReset] Failed to clear caches:', e);
  }
}

// Known IDB databases this app uses. The primary offline DB is
// `rope-works-inspections`; the auth-resilience layer keeps a small
// migration-snapshots sibling DB.
const KNOWN_DB_NAMES = [
  'rope-works-inspections',
  'idb-migration-snapshots',
];

async function unregisterAllServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch (e) {
    console.warn('[HardReset] Failed to unregister service workers:', e);
  }
}

function deleteOneDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // best-effort
      req.onblocked = () => resolve(); // resolve even if blocked; reload will retry
      // Safety timeout — if the DB is wedged behind a lock, don't hang the user.
      setTimeout(() => resolve(), 4000);
    } catch {
      resolve();
    }
  });
}

function clearBackupLedgerKeys(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('rw_backup_')) keys.push(k);
    }
    for (const k of keys) {
      try { localStorage.removeItem(k); removed++; } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('[HardReset] Failed to clear rw_backup_ keys:', e);
  }
  return removed;
}

async function deleteAllOfflineDatabases(): Promise<void> {
  const names = new Set<string>(KNOWN_DB_NAMES);
  try {
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases();
      for (const entry of list) {
        if (entry?.name) names.add(entry.name);
      }
    }
  } catch {
    // Some browsers don't expose .databases(); fall back to the known names.
  }
  await Promise.all(Array.from(names).map(deleteOneDatabase));
}

/**
 * Wipe the offline DB + SWs and reload. The reload `true` arg is a legacy
 * Firefox hint; modern browsers ignore it but `location.reload()` already
 * forces a fresh navigation.
 */
export async function hardResetDatabase(): Promise<void> {
  // 0) Freeze auto-save / drain-mode / SW caches BEFORE we touch storage.
  //    Without this, a fast auto-save tick can repopulate IDB between the
  //    delete and the reload, leaving stale rows on the next boot.
  await freezeApp();
  // 1) Drop SWs first so they can't intercept the reload or re-grab a handle
  //    on the database we're about to delete.
  await unregisterAllServiceWorkers();
  // 2) Delete every known offline IDB.
  await deleteAllOfflineDatabases();
  // 3) Clear the local backup ledger so deleted reports don't repopulate
  //    on next boot. Auth keys live elsewhere and are intentionally untouched.
  const removed = clearBackupLedgerKeys();
  if (removed > 0) console.info(`[HardReset] Cleared ${removed} rw_backup_ ledger entries`);
  // 4) Clear sessionStorage so quarantine counters and other per-session
  //    state don't repopulate the terminal after reload.
  try {
    sessionStorage.clear();
  } catch (e) {
    console.warn('[HardReset] Failed to clear sessionStorage:', e);
  }
  // 5) Hard reload. Auth lives in localStorage and is intentionally untouched.
  try {
    // @ts-expect-error legacy forceReload arg
    window.location.reload(true);
  } catch {
    window.location.reload();
  }
}
