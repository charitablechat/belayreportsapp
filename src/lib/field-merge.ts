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

/**
 * Per-field tracked list for the Training Summary singleton child row.
 * Used by TrainingForm's reconcile branch to merge the summary row
 * field-by-field instead of wholesale-replacing it (which clobbers
 * in-progress observations/recommendations text during auto-save).
 *
 * Kept separate from `TRACKED_FIELDS.training` because those live on the
 * parent `trainings` row; these live on the child `training_summary` row.
 */
export const TRAINING_SUMMARY_FIELDS = [
  'observations',
  'recommendations',
  'person_submitting',
  'submission_date',
] as const;

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

/** Row shape any child-array row must satisfy for `mergeChildArray`. */
export interface ChildArrayRow extends MergeableRecord {
  id: string;
  display_order?: number | null;
}

/** Options for `mergeChildArray`. */
export interface MergeChildArrayOptions<T extends ChildArrayRow> {
  /**
   * Per-field merge for rows present on both sides. When omitted (or empty),
   * the server row wins wholesale on overlap (callers that don't yet have
   * per-row `field_timestamps` populated server-side). Local-only rows are
   * still preserved regardless of this option — that's the bug class this
   * helper was introduced to fix.
   */
  trackedFields?: readonly string[];
  /**
   * Called once per merge invocation when at least one **non-`temp-*`** local
   * row was preserved (i.e. the server is missing rows the user thinks are
   * already synced — a real drift signal). Use for Sentry beacons. Receives
   * the count of preserved non-temp rows and an optional caller-supplied
   * table label.
   */
  onLocalOnlyPreserved?: (nonTempCount: number, table?: string) => void;
  /** Optional label forwarded to `onLocalOnlyPreserved` for telemetry. */
  table?: string;
  /**
   * Custom merge hook for rows present on both sides. When provided, this
   * overrides the default `trackedFields`-based merge. Used by callers that
   * have table-specific reconciliation logic (e.g. `mergeStandardsPreserveLocal`).
   */
  mergeRow?: (local: T, server: T) => T;
  /**
   * IDs of child rows that the user intentionally deleted during the current
   * form session. Any server row whose id is in this set is skipped — this
   * prevents a stale server snapshot (refetch racing the delete/save
   * round-trip) from resurrecting a row the user just removed.
   *
   * Membership is added to this set ONLY at the UI delete site in the parent
   * form, never as a side effect of reconcile, import, or normalization.
   */
  deletedIds?: ReadonlySet<string>;
  /**
   * Invoked once per id in `deletedIds` that did NOT appear in this server
   * snapshot. Signals "the server has confirmed this id is gone" so the
   * caller can drop it from its tracking set. Per-id confirmation keeps the
   * set bounded without relying on save lifecycle timing.
   */
  onDeletedIdConfirmed?: (id: string) => void;
  /**
   * Opt-in safety net for the temp-ID race. After the id-keyed merge runs,
   * if a row with a `temp-*` id collides with a real-id row on the
   * caller-provided business key, drop the temp row. This prevents a
   * post-navigation duplicate when the temp→real swap landed in React state
   * but the corrected id was not durably written to IndexedDB in time.
   *
   * IMPORTANT: only fires when (a) one side is temp- and the other is real,
   * and (b) every field in the key is a non-empty string/number on BOTH rows.
   * Two real-id rows are NEVER coalesced. Rows missing key fields are NEVER
   * coalesced. This keeps the helper safe to enable by default per-table.
   */
  coalesceTempByBusinessKey?: readonly string[];
}


/**
 * Merge a server-returned child-row array with the current local React state.
 *
 * The historical (and bug-causing) pattern across all three forms was
 * `setX(serverData)` — a wholesale replacement that silently drops:
 *   - `temp-*` rows the user just added but whose INSERT hasn't yet been
 *     acknowledged by the server,
 *   - any locally-newer field edits on a row that exists on both sides,
 *   - any non-temp row that the server view is transiently missing (e.g.
 *     RLS hiccup, replication lag) — preserved here, beaconed via the
 *     `onLocalOnlyPreserved` hook so we can quantify drift in prod.
 *
 * Deletion-aware: rows whose id appears in `deletedIds` are filtered out of
 * the server side so a stale refetch cannot resurrect a row the user just
 * intentionally deleted. Per-id confirmations fire via `onDeletedIdConfirmed`
 * the moment the server snapshot also stops returning the id.
 *
 * Ordering: server order is respected for rows present on the server.
 * Local-only rows are appended in their original local order. If both sides
 * carry a numeric `display_order`, the final array is stable-sorted by it
 * (ascending) so newly-added local rows land where the user placed them.
 */
export function mergeChildArray<T extends ChildArrayRow>(
  local: T[],
  server: T[],
  options: MergeChildArrayOptions<T> = {},
): T[] {
  const {
    trackedFields,
    onLocalOnlyPreserved,
    table,
    mergeRow,
    deletedIds,
    onDeletedIdConfirmed,
  } = options;

  const serverIds = new Set(server.map(r => r.id));

  // Per-id deletion confirmation: any tracked deleted id that the server
  // no longer returns is now safe to drop from the tracking set.
  if (deletedIds && deletedIds.size > 0 && onDeletedIdConfirmed) {
    for (const id of deletedIds) {
      if (!serverIds.has(id)) {
        try {
          onDeletedIdConfirmed(id);
        } catch {
          // Tracking-set maintenance must never break the merge.
        }
      }
    }
  }

  const localById = new Map(local.map(r => [r.id, r]));
  const out: T[] = [];

  // 1. Walk server order; merge field-level for rows present on both sides.
  //    Skip any server row whose id is in the local intentional-deletion set.
  for (const sr of server) {
    if (deletedIds && deletedIds.has(sr.id)) continue;
    const lr = localById.get(sr.id);
    if (!lr) {
      out.push(sr);
      continue;
    }
    if (mergeRow) {
      out.push(mergeRow(lr, sr));
    } else if (trackedFields && trackedFields.length > 0) {
      out.push(mergeRecordFields(lr, sr, [...trackedFields]));
    } else {
      // No per-field merge available — server wins on overlap. Still safe
      // because the dangerous case (local-only rows) is handled in step 2.
      out.push(sr);
    }
  }

  // 2. Preserve local-only rows. Iterate `local` (not `localById`) to keep
  //    the user's order for these stragglers.
  let nonTempPreserved = 0;
  for (const lr of local) {
    if (serverIds.has(lr.id)) continue;
    out.push(lr);
    if (!lr.id.startsWith('temp-')) nonTempPreserved += 1;
  }

  if (nonTempPreserved > 0 && onLocalOnlyPreserved) {
    try {
      onLocalOnlyPreserved(nonTempPreserved, table);
    } catch {
      // Telemetry must never break the merge.
    }
  }

  // 3. If every row carries a numeric `display_order`, sort by it so newly
  //    added rows land at the position the user picked (forms set negative
  //    `display_order` to prepend). Falls back to insertion order otherwise.
  const allOrdered = out.length > 0 && out.every(r => typeof r.display_order === 'number');
  if (allOrdered) {
    out.sort((a, b) => (a.display_order as number) - (b.display_order as number));
  }

  return out;
}
