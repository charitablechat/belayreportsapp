/**
 * Phase 1 — Read-only Training Text Recovery scan.
 *
 * Lives under src/lib/recovery/ to keep structurally separate from save / sync /
 * restore modules. Imports ONLY read APIs. A static guardrail test asserts that
 * the source contains no write tokens (db.put, db.delete, .insert(, .update(,
 * .upsert(, .delete(, clear().
 *
 * Public entry point: scanTrainingForRecoverableText(trainingId, fields)
 */

import { getDB } from '@/lib/offline-storage';
import { getVersionHistory } from '@/lib/report-version-manager';

export type RecoverableField = 'observations' | 'recommendations';

export interface RecoveryFinding {
  field: RecoverableField;
  text: string;
  /** Plain-English source label for non-technical users. */
  sourceLabel: string;
  /** Free-form short detail (e.g. "version 7"); never shown without sourceLabel. */
  sourceDetail?: string;
  /** ms epoch — best-effort. */
  timestamp: number | null;
}

const SOURCE_LABEL = {
  currentDraft: 'A draft on this device',
  parentDraft: 'A draft on this device',
  version: 'A saved version from earlier',
  backup: 'An automatic local backup on this device',
} as const;

/** Strip whitespace-only / empty-HTML strings. */
function isMeaningful(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const stripped = v
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return stripped.length > 0;
}

/** Normalize text for dedupe (whitespace + HTML-insensitive). */
function dedupeKey(field: RecoverableField, text: string): string {
  const norm = text.replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim().toLowerCase();
  return `${field}::${norm}`;
}

function pushIfMeaningful(
  acc: RecoveryFinding[],
  seen: Set<string>,
  field: RecoverableField,
  text: unknown,
  sourceLabel: string,
  timestamp: number | null,
  sourceDetail?: string,
) {
  if (!isMeaningful(text)) return;
  const key = dedupeKey(field, text);
  if (seen.has(key)) return;
  seen.add(key);
  acc.push({ field, text, sourceLabel, timestamp, sourceDetail });
}

async function scanLocalTrainingSummary(
  trainingId: string,
  fields: readonly RecoverableField[],
  acc: RecoveryFinding[],
  seen: Set<string>,
) {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('training_summary')) return;
    const tx = db.transaction('training_summary', 'readonly');
    const store = tx.objectStore('training_summary');
    // Prefer by-training index when present, else fall back to getAll filter.
    let row: Record<string, unknown> | undefined;
    try {
      if ((store as { indexNames?: DOMStringList }).indexNames?.contains?.('by-training')) {
        const idx = store.index('by-training');
        const matches = (await idx.getAll(trainingId)) as Array<Record<string, unknown>>;
        row = matches[0];
      } else {
        const all = (await store.getAll()) as Array<Record<string, unknown>>;
        row = all.find((r) => r.training_id === trainingId);
      }
    } catch {
      // best effort
    }
    await tx.done.catch(() => {});
    if (!row) return;
    const ts =
      typeof row.updated_at === 'string' ? Date.parse(row.updated_at) :
      typeof row.created_at === 'string' ? Date.parse(row.created_at) :
      null;
    for (const f of fields) {
      pushIfMeaningful(acc, seen, f, row[f], SOURCE_LABEL.currentDraft, Number.isFinite(ts as number) ? (ts as number) : null);
    }
  } catch {
    // silent — read-only, missing store is fine
  }
}

async function scanLocalTrainingParent(
  trainingId: string,
  fields: readonly RecoverableField[],
  acc: RecoveryFinding[],
  seen: Set<string>,
) {
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('trainings')) return;
    const row = (await db.get('trainings', trainingId)) as Record<string, unknown> | undefined;
    if (!row) return;
    const ts =
      typeof row.updated_at === 'string' ? Date.parse(row.updated_at) :
      typeof row.created_at === 'string' ? Date.parse(row.created_at) :
      null;
    for (const f of fields) {
      pushIfMeaningful(acc, seen, f, row[f], SOURCE_LABEL.parentDraft, Number.isFinite(ts as number) ? (ts as number) : null);
    }
  } catch {
    // silent
  }
}

async function scanVersionHistory(
  trainingId: string,
  fields: readonly RecoverableField[],
  acc: RecoveryFinding[],
  seen: Set<string>,
) {
  try {
    const versions = await getVersionHistory(trainingId);
    for (const v of versions) {
      const summary =
        (v.childrenData?.summary && (v.childrenData.summary as Array<Record<string, unknown>>)[0]) ||
        undefined;
      const candidate: Record<string, unknown> = summary ?? (v.parentData as Record<string, unknown>);
      if (!candidate) continue;
      for (const f of fields) {
        pushIfMeaningful(
          acc,
          seen,
          f,
          candidate[f],
          SOURCE_LABEL.version,
          typeof v.timestamp === 'number' ? v.timestamp : null,
          `version ${v.versionNumber}`,
        );
      }
    }
  } catch {
    // silent
  }
}

function scanLocalStorageBackups(
  trainingId: string,
  fields: readonly RecoverableField[],
  acc: RecoveryFinding[],
  seen: Set<string>,
) {
  try {
    if (typeof localStorage === 'undefined') return;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('rw_backup_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const envelope = parsed as Record<string, unknown>;
      const inner = (envelope?.data as Record<string, unknown>) ?? envelope;
      const innerId =
        (inner?.id as string | undefined) ??
        (inner?.training_id as string | undefined) ??
        (envelope?.id as string | undefined);
      const matchesParent = innerId === trainingId;
      const matchesByTrainingId = (inner?.training_id as string | undefined) === trainingId;
      if (!matchesParent && !matchesByTrainingId) {
        // Also check nested summary / children for matching training_id
        const children = inner?.children as Record<string, unknown> | undefined;
        const childSummary = children?.summary as Array<Record<string, unknown>> | undefined;
        const childMatch = childSummary?.find((s) => s?.training_id === trainingId);
        if (!childMatch) continue;
        const ts = typeof envelope.timestamp === 'number' ? envelope.timestamp : null;
        for (const f of fields) {
          pushIfMeaningful(acc, seen, f, childMatch[f], SOURCE_LABEL.backup, ts);
        }
        continue;
      }

      const ts = typeof envelope.timestamp === 'number' ? envelope.timestamp : null;

      // If the envelope itself is a training_summary row
      for (const f of fields) {
        pushIfMeaningful(acc, seen, f, inner?.[f], SOURCE_LABEL.backup, ts);
      }

      // Also try inner.summary[0] / inner.children.summary[0]
      const candidates: Array<Record<string, unknown> | undefined> = [
        (inner?.summary as Array<Record<string, unknown>> | undefined)?.[0],
        ((inner?.children as Record<string, unknown> | undefined)?.summary as Array<Record<string, unknown>> | undefined)?.[0],
      ];
      for (const cand of candidates) {
        if (!cand) continue;
        for (const f of fields) {
          pushIfMeaningful(acc, seen, f, cand[f], SOURCE_LABEL.backup, ts);
        }
      }
    }
  } catch {
    // silent
  }
}

/**
 * Read-only scan for recoverable training summary text. Returns findings
 * sorted newest-first per field, deduped across sources.
 *
 * Performs NO writes, NO deletes, NO cache clearing, NO server calls.
 */
export async function scanTrainingForRecoverableText(
  trainingId: string,
  fields: readonly RecoverableField[] = ['observations', 'recommendations'],
): Promise<RecoveryFinding[]> {
  const acc: RecoveryFinding[] = [];
  const seen = new Set<string>();

  await scanLocalTrainingSummary(trainingId, fields, acc, seen);
  await scanLocalTrainingParent(trainingId, fields, acc, seen);
  await scanVersionHistory(trainingId, fields, acc, seen);
  scanLocalStorageBackups(trainingId, fields, acc, seen);

  // Stable order: by field then newest first.
  acc.sort((a, b) => {
    if (a.field !== b.field) return a.field.localeCompare(b.field);
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });

  return acc;
}
