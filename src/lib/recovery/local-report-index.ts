/**
 * Read-only local report index for Recovery & Sync Health.
 *
 * Lists the signed-in user's reports from device-local IndexedDB FIRST so the
 * page works offline and surfaces reports that exist only on the device. The
 * caller may optionally enrich the result with RLS-scoped server reads when
 * online — server rows must never *replace* local rows.
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

/**
 * List trainings present in local IndexedDB, optionally filtered to a
 * specific user_id (shared-device safety). Returns [] on any failure.
 */
export async function listLocalTrainings(
  userId: string | null,
): Promise<LocalReportEntry[]> {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('trainings')) return [];
    const rows = (await db.getAll('trainings')) as Array<Record<string, unknown>>;
    const out: LocalReportEntry[] = [];
    for (const row of rows) {
      if (!row || typeof row.id !== 'string') continue;
      // Skip soft-deleted / quarantined rows.
      if (row._remote_deleted_at || row.deleted_at) continue;
      // Shared-device filter: only show rows that belong to the signed-in user
      // when ownership is known. Rows missing user_id are shown (best-effort —
      // they predate ownership tagging and the device user is the only viewer).
      if (userId && typeof row.user_id === 'string' && row.user_id !== userId) {
        continue;
      }
      const displayName =
        pickString(row, 'organization_name', 'site_name', 'location', 'title') ??
        'Untitled training';
      const date = pickString(row, 'training_date', 'date', 'created_at');
      const status = pickString(row, 'status');
      const subLabelParts = [date, status].filter(Boolean) as string[];
      out.push({
        kind: 'training',
        id: row.id,
        displayName,
        subLabel: subLabelParts.join(' · ') || 'Saved on this device',
        localOnly: isLocalOnly(row),
        updatedAt: parseTs(row.updated_at) ?? parseTs(row.created_at),
      });
    }
    out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return out;
  } catch {
    return [];
  }
}
