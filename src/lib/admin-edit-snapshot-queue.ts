/**
 * Admin Edit Snapshot Queue (H10)
 *
 * Holds intent records for admin pre-edit snapshots that could not be uploaded
 * to `admin_edit_snapshots` at edit time (typically because the device was
 * offline). Drained by `flushAdminEditQueue()` from `useAutoSync` at the start
 * of every sync cycle so the snapshot of the server's pre-edit state lands
 * BEFORE the admin's queued local edit syncs.
 */

import { getDB } from './offline-storage';
import { captureAdminEditSnapshotNow } from './admin-edit-snapshot';

type ReportType = 'inspection' | 'training' | 'daily_assessment';

const STORE = 'admin_edit_snapshot_queue' as const;

// Idempotency window: don't enqueue another intent for the same
// (reportType, reportId, editorId) tuple within 5 minutes. Avoids auto-save
// storms creating duplicate snapshot uploads.
const DEDUPE_WINDOW_MS = 5 * 60_000;

interface AdminEditQueueEntry {
  id?: number;
  reportType: ReportType;
  reportId: string;
  ownerId: string;
  editorId: string;
  queuedAt: number;
}

/**
 * Append an intent record to the local queue. Idempotent within
 * `DEDUPE_WINDOW_MS` per (reportType, reportId, editorId).
 */
export async function enqueueAdminEditIntent(
  reportType: ReportType,
  reportId: string,
  ownerId: string,
  editorId: string,
): Promise<void> {
  try {
    const db = await getDB();
    const tx = (db as any).transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all: AdminEditQueueEntry[] = (await store.getAll()) ?? [];
    const now = Date.now();
    const dup = all.find(
      (e) =>
        e.reportType === reportType &&
        e.reportId === reportId &&
        e.editorId === editorId &&
        now - e.queuedAt < DEDUPE_WINDOW_MS,
    );
    if (dup) {
      await tx.done;
      return;
    }
    await store.add({
      reportType,
      reportId,
      ownerId,
      editorId,
      queuedAt: now,
    } as AdminEditQueueEntry);
    await tx.done;
    if (import.meta.env.DEV) {
      console.log('[AdminEditQueue] Enqueued intent', { reportType, reportId, editorId });
    }
  } catch (err) {
    console.warn('[AdminEditQueue] enqueue failed:', err);
  }
}

/**
 * Drain the queue. For each entry, attempt to capture the snapshot now.
 * On success the entry is removed; on failure it stays for the next cycle.
 */
export async function flushAdminEditQueue(): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { uploaded, failed };
  }

  let entries: AdminEditQueueEntry[] = [];
  try {
    const db = await getDB();
    const tx = (db as any).transaction(STORE, 'readonly');
    entries = (await tx.objectStore(STORE).getAll()) ?? [];
    await tx.done;
  } catch (err) {
    console.warn('[AdminEditQueue] read failed:', err);
    return { uploaded, failed };
  }

  if (entries.length === 0) return { uploaded, failed };

  for (const entry of entries) {
    try {
      await captureAdminEditSnapshotNow(
        entry.reportType,
        entry.reportId,
        entry.ownerId,
        entry.editorId,
      );
      // Success — remove this entry
      try {
        const db = await getDB();
        const tx = (db as any).transaction(STORE, 'readwrite');
        await tx.objectStore(STORE).delete(entry.id);
        await tx.done;
        uploaded++;
      } catch (delErr) {
        console.warn('[AdminEditQueue] delete after upload failed:', delErr);
      }
    } catch (err) {
      failed++;
      console.warn('[AdminEditQueue] upload failed, will retry next cycle:', err);
    }
  }

  if (import.meta.env.DEV) {
    console.log('[AdminEditQueue] flush complete', { uploaded, failed });
  }
  return { uploaded, failed };
}

/**
 * Diagnostic: how many intents are pending upload.
 */
export async function getAdminEditQueueLength(): Promise<number> {
  try {
    const db = await getDB();
    const tx = (db as any).transaction(STORE, 'readonly');
    const count = await tx.objectStore(STORE).count();
    await tx.done;
    return count ?? 0;
  } catch {
    return 0;
  }
}
