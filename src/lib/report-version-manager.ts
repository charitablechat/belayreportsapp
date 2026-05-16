/**
 * Report Version Manager — Append-Only Immutable Version History
 *
 * Every save creates a new immutable snapshot in IndexedDB's `report_versions` store.
 * Versions are never overwritten — only appended.
 *
 * Retention (hybrid time-windowed + count-capped):
 *   - Keep ALL versions from the last 24 hours (recent window is sacrosanct).
 *   - Beyond 24h, keep one keyframe per local-day for the last 30 days
 *     (the highest-versionNumber entry of each day).
 *   - Hard ceiling of 100 versions per report; if exceeded, oldest keyframes
 *     are dropped first.
 *
 * Pruning is async and never blocks the save path. `pruneAllVersionsToMax`
 * remains available for storage-pressure-driven tighter caps.
 */

import { isMobile } from './mobile-detection';

export type ReportType = 'inspection' | 'training' | 'daily_assessment';
export type VersionTrigger = 'auto_save' | 'manual_save' | 'emergency_save' | 'pre_sync' | 'pre_delete';

export interface ReportVersion {
  id: string;
  reportType: ReportType;
  reportId: string;
  versionNumber: number;
  timestamp: number;
  device: 'mobile' | 'desktop';
  parentData: Record<string, any>;
  childrenData: Record<string, any[]>;
  trigger: VersionTrigger;
  fieldCount: number;
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const KEYFRAME_RETENTION_DAYS = 30;
const MAX_VERSIONS_PER_REPORT = 100;

// ─── M9: Versioning health tracker ───────────────────────────────────
// Surfaces silent appendVersion failures so UI can warn the user before
// they actually need recovery and find the version list empty.
export interface VersioningHealthDiagnostic {
  reportType?: ReportType;
  reportIdSuffix?: string;
  trigger?: VersionTrigger;
  storeExists?: boolean;
  missingIndexes?: string[];
  childCounts?: Record<string, number>;
  errorName?: string;
  serializationFailed?: boolean;
  step?: string;
}

export interface VersioningHealth {
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastError: string | null;
  lastSuccessAt: number | null;
  lastDiagnostic?: VersioningHealthDiagnostic | null;
}

const versioningHealth: VersioningHealth = {
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastError: null,
  lastSuccessAt: null,
  lastDiagnostic: null,
};

type HealthListener = (h: VersioningHealth) => void;
const healthListeners = new Set<HealthListener>();

function emitHealth() {
  for (const fn of healthListeners) {
    try { fn({ ...versioningHealth }); } catch { /* ignore listener errors */ }
  }
}

export function getVersioningHealth(): VersioningHealth {
  return { ...versioningHealth };
}

export function subscribeVersioningHealth(fn: HealthListener): () => void {
  healthListeners.add(fn);
  return () => healthListeners.delete(fn);
}

/**
 * Manually reset the failure counter (e.g. after the user dismisses a
 * persistent banner or successfully restores from a recovery flow).
 */
export function resetVersioningHealth(): void {
  versioningHealth.consecutiveFailures = 0;
  versioningHealth.lastError = null;
  versioningHealth.lastDiagnostic = null;
  emitHealth();
}

// ─── Structured-clone-safe sanitizer ────────────────────────────────
// IndexedDB uses the structured clone algorithm. The following throw on clone:
//   • functions, symbols, bigints
//   • DOM Nodes, Window, Event, Promise instances
//   • Proxies wrapping non-cloneable targets
//   • objects with circular references (handled by IDB but blow up
//     downstream consumers, so we drop the back-edge)
// Class instances with prototypes other than Object/Array survive cloning
// but lose their prototype; we coerce them to plain objects defensively.
const HTML_FIELD_MAX_BYTES = 50_000;

function isStructuredCloneable(v: unknown): boolean {
  try {
    // structuredClone is available in all browsers we support (Safari 15.4+).
    if (typeof structuredClone === 'function') {
      structuredClone(v);
      return true;
    }
  } catch {
    return false;
  }
  return true;
}

function toCloneSafe<T = unknown>(input: T, seen: WeakSet<object> = new WeakSet()): T {
  if (input === null || input === undefined) return input;
  const t = typeof input;
  if (t === 'string' || t === 'number' || t === 'boolean') return input;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined as unknown as T;
  if (t !== 'object') return undefined as unknown as T;

  const o = input as unknown as object;
  // Dates and primitives-in-wrappers: serialize.
  if (o instanceof Date) return (o as Date).toISOString() as unknown as T;
  // DOM/Browser objects: drop.
  if (typeof Node !== 'undefined' && o instanceof Node) return undefined as unknown as T;
  if (typeof Blob !== 'undefined' && o instanceof Blob) return undefined as unknown as T;
  if (typeof File !== 'undefined' && o instanceof File) return undefined as unknown as T;
  if (typeof Event !== 'undefined' && o instanceof Event) return undefined as unknown as T;
  if (typeof Promise !== 'undefined' && o instanceof Promise) return undefined as unknown as T;

  if (seen.has(o)) return undefined as unknown as T; // circular back-edge
  seen.add(o);

  if (Array.isArray(o)) {
    return o.map((item) => toCloneSafe(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o as Record<string, unknown>)) {
    // Drop oversized HTML-ish fields to keep version rows small.
    const val = (o as Record<string, unknown>)[key];
    if (
      typeof val === 'string' &&
      val.length > HTML_FIELD_MAX_BYTES &&
      (key.endsWith('_html') || key === 'html' || key.includes('report_html'))
    ) {
      out[key] = `[stripped: ${val.length} bytes]`;
      continue;
    }
    const sv = toCloneSafe(val, seen);
    if (sv !== undefined) out[key] = sv;
  }
  return out as unknown as T;
}

function getMissingIndexes(db: IDBDatabase): string[] {
  if (!db.objectStoreNames.contains('report_versions')) return ['<store-missing>'];
  try {
    const tx = db.transaction('report_versions', 'readonly');
    const store = tx.objectStore('report_versions');
    const required = ['by-report', 'by-timestamp', 'by-report-version'];
    const missing = required.filter((n) => !store.indexNames.contains(n));
    try { tx.abort(); } catch { /* ignore */ }
    return missing;
  } catch {
    return ['<introspection-failed>'];
  }
}

function recordVersioningFailure(
  err: unknown,
  diag: VersioningHealthDiagnostic,
): void {
  const e = err as Error | undefined;
  const message = e?.message ?? String(err);
  const name = e?.name ?? 'Error';
  versioningHealth.consecutiveFailures += 1;
  versioningHealth.lastFailureAt = Date.now();
  versioningHealth.lastError = `${name}: ${message}`;
  versioningHealth.lastDiagnostic = { ...diag, errorName: name };
  // Log structured context (no private report content).
  console.warn('[Version Manager] appendVersion failed', {
    step: diag.step,
    reportType: diag.reportType,
    reportIdSuffix: diag.reportIdSuffix,
    trigger: diag.trigger,
    storeExists: diag.storeExists,
    missingIndexes: diag.missingIndexes,
    childCounts: diag.childCounts,
    serializationFailed: diag.serializationFailed,
    errorName: name,
    errorMessage: message,
  });
  emitHealth();
}

/**
 * Count non-empty fields across parent + children for integrity checking
 */
export function calculateFieldCount(
  parentData: Record<string, any>,
  childrenData: Record<string, any[]>
): number {
  let count = 0;

  // Count non-empty parent fields
  for (const value of Object.values(parentData)) {
    if (value !== null && value !== undefined && value !== '') {
      count++;
    }
  }

  // Count total child records across all arrays
  for (const arr of Object.values(childrenData)) {
    if (Array.isArray(arr)) {
      count += arr.length;
    }
  }

  return count;
}

/**
 * Get the report_versions object store from IndexedDB
 */
async function getVersionStore(mode: IDBTransactionMode = 'readonly') {
  const { getDB } = await import('./offline-storage');
  const db = await getDB();
  
  // Check if report_versions store exists (v8+)
  if (!db.objectStoreNames.contains('report_versions')) {
    return null;
  }
  
  const tx = db.transaction('report_versions', mode);
  return tx.objectStore('report_versions');
}

/**
 * Append a new immutable version entry for a report.
 * Fire-and-forget — never blocks the caller's save path.
 *
 * Gap 2.1: MUST only be called after a confirmed successful IDB save. Calling
 * this on a failed save creates a version snapshot for data the user cannot
 * recover, which both wastes storage and lies to the user about what's saved.
 * Form auto-save code paths must therefore wrap their save calls in try/catch
 * and skip `appendVersion` on `IdbSaveError` rejection.
 */
export async function appendVersion(
  reportType: ReportType,
  reportId: string,
  parentData: Record<string, any>,
  childrenData: Record<string, any[]>,
  trigger: VersionTrigger
): Promise<ReportVersion | null> {
  const reportIdSuffix = reportId ? reportId.slice(-8) : '<no-id>';
  const childCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(childrenData ?? {})) {
    childCounts[k] = Array.isArray(v) ? v.length : 0;
  }
  const baseDiag: VersioningHealthDiagnostic = {
    reportType,
    reportIdSuffix,
    trigger,
    childCounts,
  };

  let step = 'open-db';
  let db: any;
  try {
    const { getDB } = await import('./offline-storage');
    db = await getDB();

    step = 'check-store';
    const storeExists = db.objectStoreNames.contains('report_versions');
    if (!storeExists) {
      recordVersioningFailure(
        new Error('report_versions object store missing'),
        { ...baseDiag, step, storeExists: false, missingIndexes: ['<store-missing>'] },
      );
      return null;
    }

    step = 'check-indexes';
    const missingIndexes = getMissingIndexes(db);
    if (missingIndexes.length > 0) {
      recordVersioningFailure(
        new Error(`report_versions missing indexes: ${missingIndexes.join(',')}`),
        { ...baseDiag, step, storeExists: true, missingIndexes },
      );
      return null;
    }

    // Strip large HTML fields, then deeply sanitize for structured-clone safety.
    step = 'sanitize-payload';
    const strippedParentData = { ...parentData };
    delete (strippedParentData as Record<string, unknown>).latest_report_html;

    let safeParent: Record<string, unknown>;
    let safeChildren: Record<string, unknown[]>;
    try {
      safeParent = toCloneSafe(strippedParentData) as Record<string, unknown>;
      safeChildren = toCloneSafe(childrenData) as Record<string, unknown[]>;
    } catch (sanErr) {
      recordVersioningFailure(sanErr, {
        ...baseDiag,
        step,
        storeExists: true,
        missingIndexes: [],
        serializationFailed: true,
      });
      return null;
    }

    // Fast lookup of max versionNumber via by-report-version index cursor.
    // Avoids the O(n) full-history getAll on every save.
    step = 'lookup-max-version';
    const anyDb = db as unknown as {
      transaction: (s: string, m: IDBTransactionMode) => {
        objectStore: (n: string) => any;
        done: Promise<void>;
      };
    };
    const readTx = anyDb.transaction('report_versions', 'readonly');
    const readStore = readTx.objectStore('report_versions');
    const readIdx = readStore.index('by-report-version');
    const range = IDBKeyRange.bound([reportId, 0], [reportId, Number.MAX_SAFE_INTEGER]);
    let maxVersion = 0;
    try {
      const cursor = await readIdx.openCursor(range, 'prev');
      if (cursor && cursor.value && typeof cursor.value.versionNumber === 'number') {
        maxVersion = cursor.value.versionNumber;
      }
    } catch (cursorErr) {
      // Fall back to getAll if cursor path fails (e.g., very old IDB impl).
      try {
        const all = (await readStore.index('by-report').getAll(reportId)) as ReportVersion[];
        maxVersion = all.reduce((m, v) => Math.max(m, v.versionNumber || 0), 0);
      } catch (allErr) {
        throw cursorErr instanceof Error ? cursorErr : allErr;
      }
    }
    await readTx.done;

    const nextVersion = maxVersion + 1;

    const version: ReportVersion = {
      id: crypto.randomUUID(),
      reportType,
      reportId,
      versionNumber: nextVersion,
      timestamp: Date.now(),
      device: isMobile() ? 'mobile' : 'desktop',
      parentData: safeParent,
      childrenData: safeChildren as Record<string, any[]>,
      trigger,
      fieldCount: calculateFieldCount(parentData, childrenData),
    };

    // Final clone-safety probe — surfaces a precise error before IDB does.
    step = 'clone-probe';
    if (!isStructuredCloneable(version)) {
      recordVersioningFailure(new Error('payload failed structuredClone probe'), {
        ...baseDiag,
        step,
        storeExists: true,
        missingIndexes: [],
        serializationFailed: true,
      });
      return null;
    }

    step = 'write';
    const writeTx = anyDb.transaction('report_versions', 'readwrite');
    const writeStore = writeTx.objectStore('report_versions');
    await writeStore.put(version);
    await writeTx.done;

    if (import.meta.env.DEV) {
      console.log(
        `[Version Manager] v${version.versionNumber} saved | ${reportType} | ${reportIdSuffix} | trigger=${trigger} | fields=${version.fieldCount}`
      );
    }

    pruneVersions(reportId).catch(() => {});

    // Success — reset failure streak and clear diagnostic.
    versioningHealth.consecutiveFailures = 0;
    versioningHealth.lastError = null;
    versioningHealth.lastDiagnostic = null;
    versioningHealth.lastSuccessAt = Date.now();
    emitHealth();

    return version;
  } catch (error) {
    const missingIndexes = db ? getMissingIndexes(db) : ['<db-unavailable>'];
    recordVersioningFailure(error, {
      ...baseDiag,
      step,
      storeExists: db ? db.objectStoreNames.contains('report_versions') : false,
      missingIndexes,
    });
    return null;
  }
}

/**
 * Get all versions for a report, sorted by version number descending
 */
export async function getVersionHistory(
  reportId: string
): Promise<ReportVersion[]> {
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();
    
    if (!db.objectStoreNames.contains('report_versions')) return [];

    const tx = db.transaction('report_versions', 'readonly');
    const index = tx.objectStore('report_versions').index('by-report');
    const versions = await index.getAll(reportId);
    await tx.done;

    return (versions as unknown as ReportVersion[]).sort((a, b) => b.versionNumber - a.versionNumber);
  } catch {
    return [];
  }
}

/**
 * Get the latest version for a report
 */
export async function getLatestVersion(
  reportId: string
): Promise<ReportVersion | null> {
  const versions = await getVersionHistory(reportId);
  return versions[0] || null;
}

/**
 * Get the latest field count for regression guard comparison
 */
export async function getLatestFieldCount(
  reportId: string
): Promise<number | null> {
  const latest = await getLatestVersion(reportId);
  return latest?.fieldCount ?? null;
}

/**
 * Restore a specific version to the active IndexedDB stores
 */
export async function restoreVersion(
  reportType: ReportType,
  reportId: string,
  versionId: string
): Promise<boolean> {
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();
    
    if (!db.objectStoreNames.contains('report_versions')) return false;

    const tx = db.transaction('report_versions', 'readonly');
    const version = await tx.objectStore('report_versions').get(versionId);
    await tx.done;

    if (!version) return false;

    // Dynamically import the right save functions
    const storage = await import('./offline-storage');

    if (reportType === 'inspection') {
      await storage.saveInspectionOffline(version.parentData);
      for (const [key, data] of Object.entries(version.childrenData)) {
        if (Array.isArray(data) && data.length > 0) {
          await storage.saveRelatedDataOffline(key as any, reportId, data);
        }
      }
    } else if (reportType === 'training') {
      await storage.saveTrainingOffline(version.parentData);
      for (const [key, data] of Object.entries(version.childrenData)) {
        if (Array.isArray(data) && data.length > 0) {
          await storage.saveTrainingDataOffline(key as any, reportId, data);
        }
      }
    } else if (reportType === 'daily_assessment') {
      await storage.saveDailyAssessmentOffline(version.parentData);
      for (const [key, data] of Object.entries(version.childrenData)) {
        if (Array.isArray(data) && data.length > 0) {
          await storage.saveAssessmentDataOffline(key as any, reportId, data);
        }
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[Version Manager] Restored v${version.versionNumber} for ${reportType} ${reportId.substring(0, 8)}…`);
    }

    return true;
  } catch (error) {
    console.error('[Version Manager] Restore failed:', error);
    return false;
  }
}

/**
 * Get all reports that have version history (for recovery dashboard)
 */
export async function getAllVersionedReports(): Promise<Array<{
  reportType: ReportType;
  reportId: string;
  versionCount: number;
  latestTimestamp: number;
  latestFieldCount: number;
  device: string;
}>> {
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();
    
    if (!db.objectStoreNames.contains('report_versions')) return [];

    const tx = db.transaction('report_versions', 'readonly');
    const allVersions = await tx.objectStore('report_versions').getAll() as unknown as ReportVersion[];
    await tx.done;

    // Group by reportId
    const grouped = new Map<string, ReportVersion[]>();
    for (const v of allVersions) {
      const existing = grouped.get(v.reportId) || [];
      existing.push(v);
      grouped.set(v.reportId, existing);
    }

    return Array.from(grouped.entries()).map(([reportId, versions]) => {
      const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
      return {
        reportType: latest.reportType,
        reportId,
        versionCount: versions.length,
        latestTimestamp: latest.timestamp,
        latestFieldCount: latest.fieldCount,
        device: latest.device,
      };
    }).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  } catch {
    return [];
  }
}

/**
 * Local-date key (YYYY-MM-DD) for grouping daily keyframes.
 */
function localDayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Hybrid retention prune:
 *   1. Keep all versions whose timestamp is within RECENT_WINDOW_MS (last 24h).
 *   2. For older versions, keep one keyframe per local-day (newest of that day),
 *      bounded by KEYFRAME_RETENTION_DAYS.
 *   3. If the kept set still exceeds MAX_VERSIONS_PER_REPORT, drop the oldest
 *      keyframes first (recent window is never sacrificed).
 *
 * Async; never blocks the save path.
 */
async function pruneVersions(reportId: string): Promise<void> {
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();

    if (!db.objectStoreNames.contains('report_versions')) return;

    const tx = db.transaction('report_versions', 'readonly');
    const index = tx.objectStore('report_versions').index('by-report');
    const versions = (await index.getAll(reportId)) as unknown as ReportVersion[];
    await tx.done;

    if (versions.length === 0) return;

    const now = Date.now();
    const recentCutoff = now - RECENT_WINDOW_MS;
    const keyframeCutoff = now - KEYFRAME_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const recent: ReportVersion[] = [];
    const older: ReportVersion[] = [];
    for (const v of versions) {
      if (v.timestamp >= recentCutoff) recent.push(v);
      else older.push(v);
    }

    // Keep newest version per local-day among older entries, within retention window
    const keyframeByDay = new Map<string, ReportVersion>();
    for (const v of older) {
      if (v.timestamp < keyframeCutoff) continue;
      const key = localDayKey(v.timestamp);
      const existing = keyframeByDay.get(key);
      if (!existing || v.versionNumber > existing.versionNumber) {
        keyframeByDay.set(key, v);
      }
    }
    let keyframes = Array.from(keyframeByDay.values());

    // Hard ceiling: drop oldest keyframes first if total exceeds cap
    const totalKept = recent.length + keyframes.length;
    if (totalKept > MAX_VERSIONS_PER_REPORT) {
      const overflow = totalKept - MAX_VERSIONS_PER_REPORT;
      keyframes.sort((a, b) => a.timestamp - b.timestamp);
      keyframes = keyframes.slice(Math.min(overflow, keyframes.length));
    }

    const keepIds = new Set<string>([
      ...recent.map(v => v.id),
      ...keyframes.map(v => v.id),
    ]);
    const toDelete = versions.filter(v => !keepIds.has(v.id));

    if (toDelete.length === 0) return;

    const deleteTx = db.transaction('report_versions', 'readwrite');
    const deleteStore = deleteTx.objectStore('report_versions');
    for (const v of toDelete) {
      await deleteStore.delete(v.id);
    }
    await deleteTx.done;

    if (import.meta.env.DEV) {
      console.log(
        `[Version Manager] Pruned ${toDelete.length} versions for ${reportId.substring(0, 8)}… (kept ${keepIds.size}: ${recent.length} recent + ${keyframes.length} keyframes)`
      );
    }
  } catch {
    // Pruning failure is non-critical
  }
}

/**
 * Prune ALL reports' version history to a given max.
 * Used by storage pressure manager under high pressure tiers.
 * Returns total number of pruned versions.
 */
export async function pruneAllVersionsToMax(maxVersions: number): Promise<number> {
  let totalPruned = 0;
  try {
    const { getDB } = await import('./offline-storage');
    const db = await getDB();
    
    if (!db.objectStoreNames.contains('report_versions')) return 0;

    const tx = db.transaction('report_versions', 'readonly');
    const allVersions = await tx.objectStore('report_versions').getAll() as unknown as ReportVersion[];
    await tx.done;

    // Group by reportId
    const grouped = new Map<string, ReportVersion[]>();
    for (const v of allVersions) {
      const existing = grouped.get(v.reportId) || [];
      existing.push(v);
      grouped.set(v.reportId, existing);
    }

    const toDeleteIds: string[] = [];
    for (const [, versions] of grouped) {
      if (versions.length <= maxVersions) continue;
      const sorted = versions.sort((a, b) => a.versionNumber - b.versionNumber);
      const excess = sorted.slice(0, sorted.length - maxVersions);
      for (const v of excess) {
        toDeleteIds.push(v.id);
      }
    }

    if (toDeleteIds.length > 0) {
      const deleteTx = db.transaction('report_versions', 'readwrite');
      for (const id of toDeleteIds) {
        await deleteTx.objectStore('report_versions').delete(id);
      }
      await deleteTx.done;
      totalPruned = toDeleteIds.length;
    }

    if (totalPruned > 0 && import.meta.env.DEV) {
      console.log(`[Version Manager] Pressure-pruned ${totalPruned} versions (max=${maxVersions})`);
    }
  } catch {
    // Non-critical
  }
  return totalPruned;
}
