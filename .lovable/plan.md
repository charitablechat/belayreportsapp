

## C9 — Don't silently wipe local data when remote is soft-deleted

### Problem

`src/lib/atomic-sync-manager.ts` ~lines 288–322: when a sync sees `recordStatus.is_deleted` on the server, it writes a single `appendVersion(..., 'pre_delete')` snapshot and then hard-deletes the local parent + all children from IDB. Recovery relies entirely on the version ring, which is capped at 5 entries (`MAX_VERSIONS_PER_RECORD` in `report-version-manager.ts`). With debounced auto-saves it's trivial to push the pre-delete snapshot off the end of the ring before the user notices, at which point their unsynced edits are unrecoverable.

This affects all three report types (inspection, training, daily assessment) — the remote-deleted branch lives in the shared sync entry path.

### Fix — quarantine instead of delete

When the sync detects `remote_deleted` AND the local record has unsynced edits, **do not** wipe IDB. Instead:

1. **Mark the local row as quarantined** by setting two new fields on the parent IDB row:
   - `_remote_deleted_at: <ISO timestamp from server>` — set from `recordStatus.deleted_at`.
   - `_quarantine_reason: 'remote_soft_delete'`.
   
   Children stay attached to their parent, untouched.

2. **Skip the rest of the sync for this record.** No upsert, no reconcile, no child writes — the server considers it deleted and we must not resurrect it without user intent.

3. **Emit a `sync-conflict` event** (the existing event bus already used by `sync-events.ts`) with `{ table, recordId, kind: 'remote_deleted', remoteDeletedAt }` so the UI can react.

4. **Filter quarantined rows out of normal list/dashboard queries** — `getOfflineInspections`, `getOfflineTrainings`, `getOfflineDailyAssessments` already iterate locally; add a `_remote_deleted_at == null` filter at the same point they currently filter `deleted_at == null`. Quarantined records still exist in IDB but stop appearing in the dashboard.

5. **Surface a conflict UI** — extend the existing conflict banner (`useConflicts` / `CollaboratorPresence` already render sync-status UI) with a new dialog `RemoteDeletedConflictDialog` showing: "This report was deleted by an admin while you had unsynced changes. Restore your local copy as a new report, or discard your local changes?"
   - **Restore as new**: clones the quarantined row + children under a fresh UUID, clears the quarantine fields, marks it dirty so the next sync uploads it as a new report.
   - **Discard local**: performs the original hard-delete (parent + children + version snapshot), exactly today's behavior, but now gated on explicit user consent.

6. **Keep today's behavior for the no-local-edits case.** If the local row has no unsynced edits (synced_at >= updated_at) at the moment of detection, the data on the device matches the server-side pre-delete state. We can safely delete locally without snapshotting — there's nothing to lose. The version-ring snapshot is only needed when there are unsynced edits, and in that case we now keep the *full* row in IDB instead, which is strictly better than a 5-deep ring.

### Files changed

- **`src/lib/atomic-sync-manager.ts`** — replace the `is_deleted` branch in all three sync functions (inspection / training / daily assessment) with the quarantine logic. Single shared helper `quarantineLocalForRemoteDelete(table, id, deletedAt)` to avoid drift.
- **`src/lib/offline-storage.ts`** — add `_remote_deleted_at IS NULL` filter to the three list-getters; add `quarantineRecord` and `restoreQuarantinedAsNew` helpers; export `getQuarantinedRecords(table)`.
- **`src/lib/sync-events.ts`** — add `'remote-deleted-conflict'` event type.
- **`src/hooks/useConflicts.tsx`** — subscribe to the new event, expose `remoteDeletedConflicts` alongside the existing field-merge conflicts.
- **`src/components/RemoteDeletedConflictDialog.tsx`** *(new)* — modal with Restore-as-New / Discard actions, mounted once in `RootLayout` next to the existing global dialogs.
- **`src/lib/report-version-manager.ts`** — no change. The ring stays at 5 for legitimate revision history; we just stop relying on it for delete recovery.

### Edge cases handled

- **Permanent delete (>60d retention or admin force-delete):** server returns 404/row-missing instead of `is_deleted=true`. Existing not-found path is unchanged. (Out of scope for C9.)
- **Restore-as-new collisions:** new UUID generated client-side; child FKs rewritten via the same idempotent path as C8's temp-id rewrite helpers.
- **Quarantine while offline:** local row is already quarantined; the dialog appears next time the user opens the dashboard while online.
- **Multiple devices, same report:** each device that has unsynced edits gets its own quarantine + dialog independently. Devices with no unsynced edits silently clean up as today.
- **Admin restores the report on the server later:** quarantine doesn't auto-clear (we don't poll for un-deletes). User chooses Restore-as-New if they want their edits; the server-restored report continues to exist alongside. Acceptable trade-off for correctness.

### Out of scope

- Auto-merging local edits back into the server-restored row if an admin un-deletes. Different problem; users can copy/paste from the quarantined view if needed.
- Telemetry on how often this fires.
- Trimming the version ring or reworking version history.

### Risk

Low. The change is *additive* in the dangerous direction: today we delete; tomorrow we quarantine and ask. Worst-case bug is "dialog never appears" → data sits safely in IDB under a hidden flag and the user can be recovered manually. No silent data loss path is introduced.

### Verification

- DEV scenario A (the bug): create an inspection, make 6+ debounced edits offline, have an admin soft-delete the report on the server, go online. Expect: dialog appears, "Restore as New" produces a new report on the server with all 6 edits intact. Today: edits gone.
- DEV scenario B (no unsynced edits): synced inspection, admin deletes, device syncs. Expect: local row removed silently, no dialog, dashboard updates. Same UX as today.
- DEV scenario C (offline quarantine): unsynced edits, sync detects remote-delete while user is mid-session, user dismisses dialog, closes app, reopens online. Expect: dialog re-appears (quarantine flag persists).
- DEV scenario D (restore-as-new round-trip): Restore-as-New, then sync, then refresh dashboard on a second device. Expect: new report visible on second device with the local edits.
- DEV scenario E (training + daily assessment): repeat A for the other two report types.
- Regression: `npx tsc --noEmit`; existing inspection/training/assessment list views still hide soft-deleted rows.

