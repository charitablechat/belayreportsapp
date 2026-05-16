/**
 * TEMPORARY diagnostic — find the source of the "phantom reports" on
 * the Sync Terminal. Read-only: nothing is mutated, deleted, or synced.
 *
 * Surfaces, in one JSON blob:
 *  - Live React/PWA counters as supplied by the caller.
 *  - IndexedDB unsynced rows (synced_at == null) for the three parent
 *    stores (`inspections`, `trainings`, `daily_assessments`), with id
 *    + organization/site/course label so the operator can match each
 *    row back to a Sync Terminal entry.
 *  - Every `localStorage` key starting with `rw_backup_`, parsed when
 *    possible so we can see the report id + synced flag inside the
 *    snapshot envelope.
 *  - Raw `sessionStorage["sync-quarantine-v1"]` parsed to JSON.
 *  - The validation-stuck bucket from `getValidationStuckRecords`.
 *  - Any `localStorage`/`sessionStorage` key whose name matches the
 *    sync infrastructure tokens we care about (reset, drain, breaker,
 *    halt, retry, quarantine).
 */

import { getDB } from './offline-storage';
import { getValidationStuckRecords, type ValidationBuckets } from './validation-buckets';

export interface StorageSourceDiagnostic {
  capturedAt: string;
  reactState: {
    unsyncedCount: number;
    unsyncedInspections: number;
    unsyncedTrainings: number;
    unsyncedAssessments: number;
    quarantinedCount: number;
  };
  renderedPendingReports: Array<{
    kind: string;
    id: unknown;
    label: string;
    sourceVariableName: string;
  }>;
  renderedPendingReportsSource: string;
  indexedDB: Record<string, unknown>;
  backupLedger: Array<{
    key: string;
    reportType?: string;
    reportId?: string;
    synced?: unknown;
    parseError?: string;
    rawPreview?: string;
  }>;
  quarantineRaw: unknown;
  validationStuck: ValidationBuckets | { error: string };
  matchingStorageKeys: {
    localStorage: Array<{ key: string; valuePreview: string }>;
    sessionStorage: Array<{ key: string; valuePreview: string }>;
  };
}

const PARENT_STORES = ['inspections', 'trainings', 'daily_assessments'] as const;
const KEY_PATTERN = /reset|drain|breaker|halt|retry|quarantine/i;
const QUARANTINE_KEY = 'sync-quarantine-v1';

function preview(v: string | null, max = 200): string {
  if (v == null) return '';
  return v.length > max ? `${v.slice(0, max)}…(${v.length}b)` : v;
}

function safeParseJSON(v: string | null): unknown {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}

const PER_READ_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function readUnsyncedFromStore(storeName: string): Promise<unknown> {
  try {
    const db = await withTimeout(getDB(), PER_READ_TIMEOUT_MS, `getDB(${storeName})`);
    const all = (await withTimeout(
      db.getAll(storeName as never) as Promise<Array<Record<string, unknown>>>,
      PER_READ_TIMEOUT_MS,
      `getAll(${storeName})`,
    )) as Array<Record<string, unknown>>;
    const unsynced = all.filter((r) => r?.synced_at == null);
    return {
      totalRows: all.length,
      unsyncedCount: unsynced.length,
      unsyncedRecords: unsynced.map((r) => ({
        id: r.id,
        synced_at: r.synced_at ?? null,
        updated_at: r.updated_at ?? null,
        user_id: r.user_id ?? null,
        organization: r.organization ?? null,
        site: r.site ?? null,
        location: r.location ?? null,
        course_title: r.course_title ?? null,
      })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function collectBackupLedger(): StorageSourceDiagnostic['backupLedger'] {
  const out: StorageSourceDiagnostic['backupLedger'] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('rw_backup_')) continue;
      const raw = localStorage.getItem(key);
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        const inner: any = (parsed && typeof parsed === 'object' && (parsed as any).data) || parsed;
        out.push({
          key,
          reportType: (parsed as any)?.reportType ?? (parsed as any)?.type,
          reportId: inner?.id ?? (parsed as any)?.id,
          synced: inner?.synced_at ?? (parsed as any)?.synced ?? null,
        });
      } catch (e) {
        out.push({
          key,
          parseError: e instanceof Error ? e.message : String(e),
          rawPreview: preview(raw),
        });
      }
    }
  } catch (e) {
    out.push({ key: '<scan-failed>', parseError: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

function collectMatchingKeys(): StorageSourceDiagnostic['matchingStorageKeys'] {
  const result = {
    localStorage: [] as Array<{ key: string; valuePreview: string }>,
    sessionStorage: [] as Array<{ key: string; valuePreview: string }>,
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && KEY_PATTERN.test(k)) {
        result.localStorage.push({ key: k, valuePreview: preview(localStorage.getItem(k)) });
      }
    }
  } catch { /* ignore */ }
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && KEY_PATTERN.test(k)) {
        result.sessionStorage.push({ key: k, valuePreview: preview(sessionStorage.getItem(k)) });
      }
    }
  } catch { /* ignore */ }
  return result;
}

export interface StorageSourceDiagnosticInput {
  unsyncedCount: number;
  unsyncedInspections: number;
  unsyncedTrainings: number;
  unsyncedAssessments: number;
  quarantinedCount: number;
  currentUserId: string | null | undefined;
  renderedPendingReports: StorageSourceDiagnostic['renderedPendingReports'];
  renderedPendingReportsSource: string;
}

export async function runStorageSourceDiagnostic(
  input: StorageSourceDiagnosticInput,
): Promise<StorageSourceDiagnostic> {
  const indexedDB: Record<string, unknown> = {};
  for (const store of PARENT_STORES) {
    indexedDB[store] = await readUnsyncedFromStore(store);
  }

  let validationStuck: StorageSourceDiagnostic['validationStuck'];
  try {
    validationStuck = await getValidationStuckRecords(input.currentUserId);
  } catch (e) {
    validationStuck = { error: e instanceof Error ? e.message : String(e) };
  }

  let quarantineRaw: unknown;
  try {
    quarantineRaw = safeParseJSON(sessionStorage.getItem(QUARANTINE_KEY));
  } catch (e) {
    quarantineRaw = { error: e instanceof Error ? e.message : String(e) };
  }

  return {
    capturedAt: new Date().toISOString(),
    reactState: {
      unsyncedCount: input.unsyncedCount,
      unsyncedInspections: input.unsyncedInspections,
      unsyncedTrainings: input.unsyncedTrainings,
      unsyncedAssessments: input.unsyncedAssessments,
      quarantinedCount: input.quarantinedCount,
    },
    renderedPendingReports: input.renderedPendingReports,
    renderedPendingReportsSource: input.renderedPendingReportsSource,
    indexedDB,
    backupLedger: collectBackupLedger(),
    quarantineRaw,
    validationStuck,
    matchingStorageKeys: collectMatchingKeys(),
  };
}
