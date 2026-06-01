/**
 * Read-only local report index for Recovery & Sync Health.
 *
 * Lists the signed-in user's trainings from device-local storage FIRST so the
 * page works offline and surfaces reports that exist only on the device. Two
 * sources are consulted:
 *   1. IndexedDB `trainings` store (primary)
 *   2. `localStorage` `rw_backup_*` envelopes (secondary — surfaces reports
 *      that were rescued into a local backup but no longer exist in IDB).
 *
 * The caller may optionally enrich the result with RLS-scoped server reads
 * when online — server rows must never *replace* local rows.
 *
 * Structurally read-only: imports only from @/lib/offline-storage. A static
 * guardrail test asserts the absence of write tokens.
 */

import { getDB } from '@/lib/offline-storage';

export type LocalReportKind = 'training';

export interface LocalReportEntry {
  kind: LocalReportKind;
  id: string;
  /** Plain-English display name (org / site / fallback). */
  displayName: string;
  /** Plain-English secondary line (date / status). */
  subLabel: string;
  /** True when only present locally (no synced_at, or marked dirty/unsynced). */
  localOnly: boolean;
  /** ms epoch — best-effort. */
  updatedAt: number | null;
  /** Optional trainer/inspector display name when known locally. */
  trainerName?: string | null;
  /** Optional start date (YYYY-MM-DD) when known. */
  startDate?: string | null;
  /** Optional report status when known. */
  status?: string | null;
  /** True when the row was discovered only via an rw_backup_* envelope. */
  fromBackupOnly?: boolean;
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseTs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function isLocalOnly(row: Record<string, unknown>): boolean {
  const synced = row.synced_at ?? row.last_synced_at;
  if (synced) return false;
  if (row.dirty === 1 || row.dirty === true) return true;
  if (typeof row.id === 'string' && row.id.startsWith('temp-')) return true;
  return !synced;
}

function ownerOf(row: Record<string, unknown>): string | null {
  return (
    (typeof row.inspector_id === 'string' && row.inspector_id) ||
    (typeof row.user_id === 'string' && (row.user_id as string)) ||
    (typeof row.trainer_id === 'string' && (row.trainer_id as string)) ||
    null
  );
}

function buildEntryFromIdbRow(row: Record<string, unknown>): LocalReportEntry | null {
  if (!row || typeof row.id !== 'string') return null;
  if (row._remote_deleted_at || row.deleted_at) return null;
  const displayName =
    pickString(row, 'organization', 'organization_name', 'location', 'site_name', 'title') ??
    'Untitled training';
  const startDate = pickString(row, 'start_date', 'training_date', 'date');
  const status = pickString(row, 'status');
  const trainerName =
    pickString(row, 'trainer_of_record', 'trainer_name', 'inspector_name') ?? null;
  const subParts = [startDate, status].filter(Boolean) as string[];
  return {
    kind: 'training',
    id: row.id,
    displayName,
    subLabel: subParts.join(' · ') || 'Saved on this device',
    localOnly: isLocalOnly(row),
    updatedAt: parseTs(row.updated_at) ?? parseTs(row.created_at),
    trainerName,
    startDate,
    status,
    fromBackupOnly: false,
  };
}

/**
 * Walk `localStorage` for `rw_backup_*` envelopes and yield extra training
 * entries for ids not already present in `existingIds`. Always returns; never
 * throws. Each envelope is parsed defensively.
 */
function listLocalBackupTrainings(
  userId: string | null,
  existingIds: ReadonlySet<string>,
): LocalReportEntry[] {
  const out: LocalReportEntry[] = [];
  try {
    if (typeof localStorage === 'undefined') return out;
    const seen = new Set<string>(existingIds);
    for (let i = 0; i < localStorage.length; i++) {
      let key: string | null = null;
      try {
        key = localStorage.key(i);
      } catch {
        continue;
      }
      if (!key || !key.startsWith('rw_backup_')) continue;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        continue;
      }
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const envelope = parsed as Record<string, unknown>;
      const ts =
        typeof envelope.timestamp === 'number' ? envelope.timestamp : null;
      const inner =
        (envelope.data && typeof envelope.data === 'object'
          ? (envelope.data as Record<string, unknown>)
          : null) ?? envelope;

      // Candidate training id locations.
      const idCandidates: Array<unknown> = [
        inner?.id,
        inner?.training_id,
        envelope.id,
        envelope.training_id,
      ];
      const children = inner?.children as Record<string, unknown> | undefined;
      const childSummary =
        (children?.summary as Array<Record<string, unknown>> | undefined) ??
        (inner?.summary as Array<Record<string, unknown>> | undefined);
      if (Array.isArray(childSummary)) {
        for (const s of childSummary) {
          if (s && typeof s === 'object') idCandidates.push(s.training_id);
        }
      }

      for (const c of idCandidates) {
        if (typeof c !== 'string' || !c) continue;
        if (seen.has(c)) continue;

        // Owner scoping: when an owner is present and known, skip if mismatched.
        const envOwner = ownerOf(inner) ?? ownerOf(envelope);
        if (userId && envOwner && envOwner !== userId) continue;

        seen.add(c);
        const displayName =
          pickString(inner, 'organization', 'organization_name', 'location', 'site_name', 'title') ??
          pickString(envelope, 'organization', 'organization_name', 'location', 'site_name', 'title') ??
          'Training (local backup)';
        const startDate =
          pickString(inner, 'start_date', 'training_date', 'date') ??
          pickString(envelope, 'start_date', 'training_date', 'date');
        const status =
          pickString(inner, 'status') ?? pickString(envelope, 'status');
        const trainerName =
          pickString(inner, 'trainer_of_record', 'trainer_name', 'inspector_name') ??
          pickString(envelope, 'trainer_of_record', 'trainer_name', 'inspector_name');
        const subParts = [startDate, status, 'local backup only'].filter(Boolean) as string[];
        out.push({
          kind: 'training',
          id: c,
          displayName,
          subLabel: subParts.join(' · '),
          localOnly: true,
          updatedAt: ts,
          trainerName,
          startDate,
          status,
          fromBackupOnly: true,
        });
      }
    }
  } catch {
    // silent — never throw
  }
  return out;
}

/**
 * Status-bearing result for the Recovery & Sync Health page.
 *
 *  - `entries` — discovered trainings (IDB + backup envelopes, deduped).
 *  - `idbUnavailable` — true when the IDB read could not be completed
 *    (timed out, threw, or returned an unusable handle). Used by the page
 *    to render a safe error card instead of a misleading "no trainings"
 *    empty state.
 *  - `partial` — true when at least one IDB row threw inside row-shape
 *    parsing and was skipped; the rest of the list is still returned.
 *
 * Backup-envelope discovery ALWAYS runs, even when IDB is unavailable, so
 * locally recoverable backup data is still surfaced.
 */
export interface LocalTrainingsResult {
  entries: LocalReportEntry[];
  idbUnavailable: boolean;
  partial: boolean;
}

/** Wall-clock budget for the IDB phase. Healthy opens are < 100 ms. */
const IDB_PHASE_BUDGET_MS = 3000;

async function readIdbTrainings(
  userId: string | null,
): Promise<{ entries: LocalReportEntry[]; idbUnavailable: boolean; partial: boolean }> {
  const idbEntries: LocalReportEntry[] = [];
  let idbUnavailable = false;
  let partial = false;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'__timeout__'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('__timeout__'), IDB_PHASE_BUDGET_MS);
  });

  try {
    const raced = await Promise.race([getDB(), timeoutPromise]);
    if (raced === '__timeout__') {
      idbUnavailable = true;
    } else {
      const db = raced as Awaited<ReturnType<typeof getDB>>;
      try {
        if (db && db.objectStoreNames && db.objectStoreNames.contains('trainings')) {
          const rows = (await db.getAll('trainings')) as Array<Record<string, unknown>>;
          for (const row of rows) {
            try {
              if (!row || typeof row.id !== 'string') continue;
              if (row._remote_deleted_at || row.deleted_at) continue;
              const rowOwner = ownerOf(row);
              if (userId && rowOwner && rowOwner !== userId) continue;
              const entry = buildEntryFromIdbRow(row);
              if (entry) idbEntries.push(entry);
            } catch {
              // Per-row fault isolation — one malformed record must not
              // drop every other training. Mark the result as partial.
              partial = true;
            }
          }
        }
        // Store missing → treat as readable-but-empty (legacy behavior
        // covered by existing tests). idbUnavailable stays false.
      } catch {
        idbUnavailable = true;
      }
    }
  } catch {
    idbUnavailable = true;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return { entries: idbEntries, idbUnavailable, partial };
}

/**
 * Status-bearing variant used by Recovery & Sync Health to render safe
 * loading / error / partial / empty states. Backup-envelope discovery runs
 * regardless of IDB health.
 *
 * Never rejects.
 */
export async function listLocalTrainingsWithStatus(
  userId: string | null,
): Promise<LocalTrainingsResult> {
  let idbPhase: { entries: LocalReportEntry[]; idbUnavailable: boolean; partial: boolean } = {
    entries: [],
    idbUnavailable: false,
    partial: false,
  };
  try {
    idbPhase = await readIdbTrainings(userId);
  } catch {
    idbPhase = { entries: [], idbUnavailable: true, partial: false };
  }

  let backupEntries: LocalReportEntry[] = [];
  try {
    const existingIds = new Set(idbPhase.entries.map((e) => e.id));
    backupEntries = listLocalBackupTrainings(userId, existingIds);
  } catch {
    backupEntries = [];
  }

  const all = [...idbPhase.entries, ...backupEntries];
  all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return {
    entries: all,
    idbUnavailable: idbPhase.idbUnavailable,
    partial: idbPhase.partial,
  };
}

/**
 * Backward-compatible array form. Returns [] on any failure.
 */
export async function listLocalTrainings(
  userId: string | null,
): Promise<LocalReportEntry[]> {
  try {
    const r = await listLocalTrainingsWithStatus(userId);
    return r.entries;
  } catch {
    return [];
  }
}

