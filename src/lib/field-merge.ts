/**
 * Field-level merge for collaborative editing across devices.
 *
 * Strategy: each parent report row carries a `field_timestamps` JSONB map.
 * On sync, every tracked field is compared independently — newer timestamp
 * wins. Fields neither device touched are unchanged. Two devices editing
 * different sections both keep their work.
 *
 * Rules:
 *  - Attestation fields are NEVER overwritten once `attestation_signed_at`
 *    is set on either side ("first-sign wins").
 *  - Missing timestamps fall back to the row-level `updated_at`.
 *  - The merged row's `field_timestamps` is the per-key max of both inputs.
 */

export type FieldTimestamps = Record<string, string>;

export interface MergeableRecord {
  updated_at?: string | null;
  field_timestamps?: FieldTimestamps | null;
  attestation_signed_at?: string | null;
  [key: string]: unknown;
}

/** Fields tracked for field-level merge per report type. */
export const TRACKED_FIELDS: Record<'inspection' | 'training' | 'daily_assessment', string[]> = {
  inspection: [
    'organization', 'location', 'acct_number', 'onsite_contact',
    'previous_inspector', 'previous_inspection_date', 'inspection_date',
    'course_history', 'organization_id',
  ],
  training: [
    'organization', 'location', 'site', 'training_date', 'training_type',
    'trainer_of_record', 'observations', 'recommendations',
    'person_submitting', 'submission_date', 'organization_id',
  ],
  daily_assessment: [
    'organization', 'site', 'assessment_date', 'trainer_of_record',
    'systems_comments', 'structure_comments', 'environment_comments',
    'organization_id',
  ],
};

/** Fields that must never be overwritten once a signature exists on either side. */
const ATTESTATION_FIELDS = [
  'attestation_signed_at',
  'attestation_signer_id',
  'attestation_signer_name',
  'attestation_text',
  'attestation_ip',
  'attestation_user_agent',
  'app_version_at_completion',
];

function tsOf(rec: MergeableRecord, field: string): { ts: number; explicit: boolean } {
  const ft = rec.field_timestamps?.[field];
  if (ft) {
    const t = new Date(ft).getTime();
    if (!isNaN(t)) return { ts: t, explicit: true };
  }
  if (rec.updated_at) {
    const t = new Date(rec.updated_at).getTime();
    if (!isNaN(t)) return { ts: t, explicit: false };
  }
  return { ts: 0, explicit: false };
}

/**
 * Merge two versions of the same record field-by-field. Newer per-field
 * timestamp wins. Returns a new merged record plus the unified
 * `field_timestamps` map.
 */
export function mergeRecordFields<T extends MergeableRecord>(
  local: T,
  remote: T,
  trackedFields: string[],
): T {
  const merged: MergeableRecord = { ...remote, ...local };
  const mergedTimestamps: FieldTimestamps = {
    ...(remote.field_timestamps ?? {}),
    ...(local.field_timestamps ?? {}),
  };

  for (const field of trackedFields) {
    const localT = tsOf(local, field);
    const remoteT = tsOf(remote, field);

    // An explicit per-field timestamp always beats a row-level fallback.
    let useRemote: boolean;
    if (localT.explicit && !remoteT.explicit) useRemote = false;
    else if (remoteT.explicit && !localT.explicit) useRemote = true;
    else useRemote = remoteT.ts > localT.ts;

    if (useRemote) {
      (merged as Record<string, unknown>)[field] = (remote as Record<string, unknown>)[field];
      if (remote.field_timestamps?.[field]) {
        mergedTimestamps[field] = remote.field_timestamps[field];
      }
    } else {
      (merged as Record<string, unknown>)[field] = (local as Record<string, unknown>)[field];
      if (local.field_timestamps?.[field]) {
        mergedTimestamps[field] = local.field_timestamps[field];
      }
    }
  }

  // First-sign-wins for attestation
  const localSigned = !!local.attestation_signed_at;
  const remoteSigned = !!remote.attestation_signed_at;
  if (localSigned || remoteSigned) {
    const signedSide = localSigned && remoteSigned
      ? (new Date(local.attestation_signed_at!).getTime() <=
         new Date(remote.attestation_signed_at!).getTime() ? local : remote)
      : (localSigned ? local : remote);
    for (const f of ATTESTATION_FIELDS) {
      (merged as Record<string, unknown>)[f] = (signedSide as Record<string, unknown>)[f];
    }
  }

  merged.field_timestamps = mergedTimestamps;
  // Updated_at = newer of the two so subsequent syncs see the merged version as fresh
  const localUpd = local.updated_at ? new Date(local.updated_at).getTime() : 0;
  const remoteUpd = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
  merged.updated_at = new Date(Math.max(localUpd, remoteUpd, Date.now())).toISOString();

  return merged as T;
}

/**
 * Helper for the write path: stamps a single field's timestamp when its
 * value changes. Use inside form pages so each user edit is attributable.
 */
export function setFieldWithTimestamp<T extends MergeableRecord>(
  record: T,
  field: string,
  value: unknown,
): T {
  const next: MergeableRecord = { ...record, [field]: value };
  next.field_timestamps = {
    ...(record.field_timestamps ?? {}),
    [field]: new Date().toISOString(),
  };
  return next as T;
}

/**
 * Form-side write helper: applies a single field write and stamps an
 * explicit `field_timestamps[field]` entry IFF the field is tracked for
 * this report kind. Always bumps `updated_at` so the unsynced-counts
 * detector sees the row as dirty.
 *
 * Why this exists: form pages used to manually `{ ...record, [field]: value,
 * updated_at: now }`, which never populated `field_timestamps`. The
 * cross-device merger in `mergeRecordFields` then degraded to row-level
 * last-writer-wins for every tracked field. Routing every tracked-field
 * write through this helper restores the per-field merge invariant
 * (`atomic-sync-manager.ts` S16/H4) without forcing each call site to
 * memorise the tracked-fields list.
 *
 * Untracked fields (e.g. `status`, `inspector_id`, `latest_report_html`)
 * pass through unchanged — only their value + `updated_at` are written.
 */
export function applyTrackedFieldWrite<T extends MergeableRecord>(
  record: T,
  reportKind: 'inspection' | 'training' | 'daily_assessment',
  field: string,
  value: unknown,
): T {
  const isTracked = TRACKED_FIELDS[reportKind].includes(field);
  const nowIso = new Date().toISOString();
  const next: MergeableRecord = {
    ...record,
    [field]: value,
    updated_at: nowIso,
  };
  if (isTracked) {
    next.field_timestamps = {
      ...(record.field_timestamps ?? {}),
      [field]: nowIso,
    };
  }
  return next as T;
}

/**
 * Batch variant of `applyTrackedFieldWrite` for callers that update
 * multiple fields at once (e.g. completion handlers writing several
 * tracked fields in a single transaction). All tracked fields share
 * the same timestamp so they merge as a single edit on the remote side.
 */
export function applyTrackedFieldsWrite<T extends MergeableRecord>(
  record: T,
  reportKind: 'inspection' | 'training' | 'daily_assessment',
  patch: Record<string, unknown>,
): T {
  const tracked = TRACKED_FIELDS[reportKind];
  const nowIso = new Date().toISOString();
  const nextTimestamps: FieldTimestamps = { ...(record.field_timestamps ?? {}) };
  let stamped = false;
  for (const key of Object.keys(patch)) {
    if (tracked.includes(key)) {
      nextTimestamps[key] = nowIso;
      stamped = true;
    }
  }
  const next: MergeableRecord = {
    ...record,
    ...patch,
    updated_at: nowIso,
  };
  if (stamped) {
    next.field_timestamps = nextTimestamps;
  }
  return next as T;
}

/** Tombstone-vs-edit guard for child rows. */
export function shouldKeepEditedChild(
  child: { updated_at?: string | null },
  parentLastPulledAt: string | null | undefined,
): boolean {
  if (!parentLastPulledAt || !child.updated_at) return false;
  return new Date(child.updated_at).getTime() > new Date(parentLastPulledAt).getTime();
}
