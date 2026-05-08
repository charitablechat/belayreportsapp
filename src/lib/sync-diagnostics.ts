/**
 * Sync diagnostics — surface "silent" pending buckets to the user so a
 * persistent backlog (the "37 / 46 pending that never drains" symptom on
 * iPad) can be both explained and remediated without dev tools.
 *
 * Two buckets are surfaced here:
 *   1. orphan records — temp-* inspections / trainings / daily-assessments
 *      whose `inspector_id` does not match the current user. Visible on
 *      shared devices as cross-user leftovers; they sit in the dashboard's
 *      pending count forever because they cannot pass RLS for the current
 *      session.
 *   2. temp-parent photos — photos whose parent `inspectionId` is still
 *      `temp-…`. Each cycle bumps retryCount until dead-letter; until then
 *      they hold the photo count up.
 *
 * Both readers reuse the existing `getDB()` / read-boundary helpers and are
 * fully tolerant of IDB read failure (return zero counts + empty arrays
 * rather than throwing) so the badge can never be zeroed by a transient
 * read error.
 */
import { getDB } from './offline-storage';
import { getUserWithCache } from './cached-auth';
import { syncLog } from './sync-logger';

export interface OrphanRecord {
  id: string;
  table: 'inspections' | 'trainings' | 'daily_assessments';
  organization?: string | null;
  inspector_id?: string | null;
  updated_at?: string | null;
}

export interface TempParentPhoto {
  id: string;
  inspectionId: string;
  fileName?: string;
  retryCount: number;
}

export interface SyncDiagnosticsReport {
  orphanRecords: OrphanRecord[];
  tempParentPhotos: TempParentPhoto[];
  /** True iff one of the IDB reads threw — counts may be partial. */
  partial: boolean;
}

/**
 * Single-pass diagnostic read. Never throws. Empty buckets when current user
 * is missing or IDB is unavailable.
 */
export async function collectSyncDiagnostics(): Promise<SyncDiagnosticsReport> {
  const empty: SyncDiagnosticsReport = {
    orphanRecords: [],
    tempParentPhotos: [],
    partial: false,
  };
  let user: { id: string } | null = null;
  try {
    user = await getUserWithCache();
  } catch {
    return { ...empty, partial: true };
  }
  if (!user) return empty;

  const out: SyncDiagnosticsReport = { ...empty, orphanRecords: [], tempParentPhotos: [] };

  let db: Awaited<ReturnType<typeof getDB>> | null = null;
  try {
    db = await getDB();
  } catch (e) {
    syncLog.warn('[SyncDiagnostics] getDB failed', e);
    return { ...empty, partial: true };
  }

  // 1. Orphan records (temp-… ids whose inspector_id !== current user).
  for (const table of ['inspections', 'trainings', 'daily_assessments'] as const) {
    try {
      const all = await db.getAll(table as never);
      for (const rec of all as Array<Record<string, unknown>>) {
        const id = String(rec.id ?? '');
        if (!id.startsWith('temp-')) continue;
        const inspectorId = (rec.inspector_id as string | null | undefined) ?? null;
        if (inspectorId === user.id) continue;
        // Skip soft-deleted
        if (rec.deleted_at) continue;
        out.orphanRecords.push({
          id,
          table,
          organization: (rec.organization as string | null | undefined) ?? null,
          inspector_id: inspectorId,
          updated_at: (rec.updated_at as string | null | undefined) ?? null,
        });
      }
    } catch (e) {
      syncLog.warn(`[SyncDiagnostics] read failed for ${table}`, e);
      out.partial = true;
    }
  }

  // 2. Temp-parent photos (parent id still temp-… AND retryCount < 5).
  try {
    const tx = db.transaction('photos', 'readonly');
    const idx = tx.store.index('by-uploaded');
    const unuploaded = await idx.getAll(IDBKeyRange.only(0));
    await tx.done;
    for (const p of unuploaded as Array<Record<string, unknown>>) {
      const inspectionId = String(p.inspectionId ?? '');
      if (!inspectionId.startsWith('temp-')) continue;
      const retryCount = Number(p.retryCount ?? 0);
      if (retryCount >= 5) continue; // dead-letter handled elsewhere
      out.tempParentPhotos.push({
        id: String(p.id ?? ''),
        inspectionId,
        fileName: (p.fileName as string | undefined),
        retryCount,
      });
    }
  } catch (e) {
    syncLog.warn('[SyncDiagnostics] photos read failed', e);
    out.partial = true;
  }

  return out;
}

/**
 * Reassign a single orphan record's inspector_id to the current user, then
 * stamp dirty so the next sync cycle pushes it. Caller is responsible for
 * confirming with the user before calling.
 */
export async function reassignOrphanToCurrentUser(
  table: 'inspections' | 'trainings' | 'daily_assessments',
  id: string,
): Promise<boolean> {
  const user = await getUserWithCache();
  if (!user) return false;
  let db: Awaited<ReturnType<typeof getDB>>;
  try {
    db = await getDB();
  } catch {
    return false;
  }
  const rec = await db.get(table as never, id);
  if (!rec) return false;
  const updated = {
    ...(rec as Record<string, unknown>),
    inspector_id: user.id,
    dirty: true,
    updated_at: new Date().toISOString(),
  };
  await db.put(table as never, updated as never);
  return true;
}

/**
 * Hard-delete an orphan record locally. Only call after explicit user
 * confirmation — there is no undo (these are temp-* records that have never
 * synced).
 */
export async function deleteOrphanLocally(
  table: 'inspections' | 'trainings' | 'daily_assessments',
  id: string,
): Promise<boolean> {
  let db: Awaited<ReturnType<typeof getDB>>;
  try {
    db = await getDB();
  } catch {
    return false;
  }
  await db.delete(table as never, id);
  return true;
}
