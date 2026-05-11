/**
 * Sync Terminal "STUCK (validation)" bucket — companion surface to the
 * form-side gate from PR #178.
 *
 * Background
 * ----------
 * PR #178 closed the *forward* leak: the three report forms now refuse
 * to persist a write that violates the matching Zod parent-schema
 * required-field invariants (organization, location, dates, …). That
 * prevents new records from getting stranded — but it does NOT help
 * records that were already stranded on a user's device when PR #178
 * shipped (a previously-good record that someone cleared organization
 * on, persisted, and walked away from).
 *
 * Those records:
 *   - live in the device's IDB with `synced_at = null`
 *   - re-throw `Validation failed: [...]` from the matching
 *     `atomic-sync-manager.syncXAtomic` on every sync cycle
 *   - never reach the server
 *   - never surface to the user — the existing Sync Terminal photo
 *     buckets (READY/RETRYING/STUCK from PR #166) only handle photos,
 *     not parent records that fail validation
 *
 * This module re-runs the matching parent validator on every unsynced
 * parent record and returns a bucket of records that would currently
 * fail at sync time. The Sync Terminal renders that bucket below the
 * PENDING_PHOTOS section with a "FIX" deep-link to the offending
 * record so the user can recover it without server-side intervention.
 *
 * Read-only: this module does NOT mutate IDB or attempt any sync; it
 * only inspects the unsynced queue. It is safe to call repeatedly.
 */

import { validateInspection } from '@/lib/validation-schemas';
import { validateTraining } from '@/lib/training-validation-schemas';
import { validateDailyAssessment } from '@/lib/daily-assessment-validation-schemas';
import {
  getUnsyncedInspections,
  getUnsyncedTrainings,
  getUnsyncedDailyAssessments,
} from '@/lib/offline-storage';

export type ValidationStuckKind = 'inspection' | 'training' | 'daily_assessment';

export interface ValidationStuckRecord {
  /** Record id (real UUID once initially synced; `temp-…` if never synced). */
  readonly id: string;
  /** Which report kind the record belongs to. */
  readonly kind: ValidationStuckKind;
  /**
   * Human-readable label rendered in the Sync Terminal row. Mirrors the
   * fallback chain the existing unsynced-record list uses
   * (organization → site → 'Untitled').
   */
  readonly label: string;
  /**
   * Dotted field paths the Zod validator complained about
   * (e.g. ['organization', 'assessment_date']). De-duplicated.
   */
  readonly missingFields: readonly string[];
  /** Route the "FIX" button navigates to (e.g. `/daily-assessment/<id>`). */
  readonly deepLinkPath: string;
}

export interface ValidationBuckets {
  /** Total count across all three report kinds. */
  readonly count: number;
  /** Stable order: inspections, trainings, daily_assessments. */
  readonly records: readonly ValidationStuckRecord[];
}

const EMPTY: ValidationBuckets = { count: 0, records: [] };

interface ZodIssueLike {
  readonly path?: ReadonlyArray<string | number>;
}

interface ValidatorResult {
  readonly success: boolean;
  readonly errors: ReadonlyArray<ZodIssueLike> | null;
}

interface UnsyncedRecordLike {
  readonly id?: string;
  readonly organization?: string | null;
  readonly site?: string | null;
  readonly location?: string | null;
  readonly course_title?: string | null;
}

/**
 * Build the user-facing label for a stuck record. Mirrors the
 * fallback chain already used inside `SyncPulse.tsx`'s unsynced-record
 * list so the two surfaces stay visually consistent.
 */
function labelFor(record: UnsyncedRecordLike, kind: ValidationStuckKind): string {
  const explicit =
    record.organization ??
    record.site ??
    record.location ??
    record.course_title;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (kind === 'inspection') return 'Untitled Inspection';
  if (kind === 'training') return 'Untitled Training';
  return 'Untitled Assessment';
}

/**
 * Convert a Zod issue list into a de-duplicated, top-level-only list of
 * field names. The Sync Terminal only displays top-level identifiers
 * (e.g. `organization`, `assessment_date`) — nested array element paths
 * like `systems.0.type` would clutter the surface without giving the
 * user anything actionable.
 */
function extractMissingFields(
  errors: ReadonlyArray<ZodIssueLike> | null,
): string[] {
  if (!errors || errors.length === 0) return [];
  const seen = new Set<string>();
  for (const issue of errors) {
    const first = issue.path?.[0];
    if (typeof first === 'string' && first.length > 0) {
      seen.add(first);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Pure bucket-builder. Exposed for unit testing so we can drive it with
 * synthetic record arrays + validator stubs without standing up a real
 * IDB. The runtime `getValidationStuckRecords` below wires this to the
 * actual validators + IDB readers.
 */
export function bucketValidationFailures(
  inspections: ReadonlyArray<UnsyncedRecordLike>,
  trainings: ReadonlyArray<UnsyncedRecordLike>,
  assessments: ReadonlyArray<UnsyncedRecordLike>,
  validators: {
    readonly inspection: (data: unknown) => ValidatorResult;
    readonly training: (data: unknown) => ValidatorResult;
    readonly daily_assessment: (data: unknown) => ValidatorResult;
  },
): ValidationBuckets {
  const out: ValidationStuckRecord[] = [];

  const pushIfStuck = (
    record: UnsyncedRecordLike,
    kind: ValidationStuckKind,
    deepLinkBase: string,
  ): void => {
    if (!record.id) return;
    const result = validators[kind](record);
    if (result.success) return;
    const missingFields = extractMissingFields(result.errors);
    out.push({
      id: record.id,
      kind,
      label: labelFor(record, kind),
      missingFields,
      deepLinkPath: `${deepLinkBase}/${record.id}`,
    });
  };

  for (const r of inspections) pushIfStuck(r, 'inspection', '/inspection');
  for (const r of trainings) pushIfStuck(r, 'training', '/training');
  for (const r of assessments) pushIfStuck(r, 'daily_assessment', '/daily-assessment');

  return { count: out.length, records: out };
}

/**
 * Re-run the matching parent validator on every unsynced record across
 * the three report stores and return the records that would currently
 * fail at sync time.
 *
 * Read-only: does not mutate IDB or trigger a sync. Returns `EMPTY` on
 * any unexpected error so a transient read failure can't blank the
 * Sync Terminal section (matches the boundary behavior of
 * `getPhotoRetryBuckets`).
 */
export async function getValidationStuckRecords(): Promise<ValidationBuckets> {
  try {
    const [inspections, trainings, assessments] = await Promise.all([
      getUnsyncedInspections(),
      getUnsyncedTrainings(),
      getUnsyncedDailyAssessments(),
    ]);
    return bucketValidationFailures(
      inspections as ReadonlyArray<UnsyncedRecordLike>,
      trainings as ReadonlyArray<UnsyncedRecordLike>,
      assessments as ReadonlyArray<UnsyncedRecordLike>,
      {
        inspection: validateInspection,
        training: validateTraining,
        daily_assessment: validateDailyAssessment,
      },
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[validation-buckets] read failed, returning empty:', err);
    }
    return EMPTY;
  }
}
