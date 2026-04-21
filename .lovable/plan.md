

## Resume: eliminate remaining child-row deletion vectors (V4–V8)

Picking up exactly where the previous attempt was cancelled. Same approved plan, no scope changes.

### Implementation order

1. **NEW `src/lib/child-row-deletion-tripwire.ts`** (~60 lines)
   - `assertSafeToDeleteChildRows({ table, parentFkColumn, parentId, idsToDelete, context })` 
   - Re-fetches current server child count for the parent
   - Refuses if deletion would remove >70% in one shot unless `context.bulk === true`
   - On refusal: logs to `report_deleted_items` with `reason: 'tripwire_blocked'` and full call-site context, returns `{ allowed: false }`
   - On allow: returns `{ allowed: true }`

2. **`src/lib/sync-reconciliation.ts`** — V4 + V5
   - Drop `serverCount > 2` floor; apply 50% rule whenever `serverCount >= 1`
   - Add absolute-delta tripwire: if `serverCount - localCount >= 3`, always block
   - Add `expectedNonEmpty?: boolean` parameter; when `false` and `localCount === 0`, never prune
   - Wire `assertSafeToDeleteChildRows` before the actual `.delete().in('id', ...)` call

3. **`src/lib/atomic-sync-manager.ts`** — instrument IDB reads
   - Small helper `readChildrenWithSuccessFlag(reportId, table)` that returns `{ items, readSucceeded }` based on whether the IDB error boundary fell back
   - Pass `readSucceeded` through to `reconcileAllChildTables` per table as `expectedNonEmpty`
   - Apply to `syncInspectionAtomic`, `syncTrainingAtomic`, `syncDailyAssessmentAtomic`

4. **`src/lib/admin-edit-snapshot.ts`** — V7
   - Before per-table delete in `restoreAdminEditSnapshot`: skip delete entirely if snapshot's `children[table]` is empty/missing; log warning
   - Capture a `pre_restore` snapshot of current server state into `admin_edit_snapshots` before applying restore
   - Route the per-table replacement deletes through `assertSafeToDeleteChildRows` with `context: { bulk: true, reason: 'admin_restore' }`

5. **`public/sw-sync.js`** — V6
   - Read `child_count_hint` from the parent's local record at sync time
   - If live IDB child read produces total count <50% of hint, skip syncing that record this cycle and report it in `SYNC_COMPLETED.skippedSuspicious`
   - Stamp `child_count_hint = total children at save time` whenever the main thread successfully saves a parent (one-line addition in `saveInspectionOffline` / `saveTrainingOffline` / `saveDailyAssessmentOffline`)

6. **`src/lib/offline-storage.ts`** — V8
   - In `evictSyncedReports`: 
     - Skip if any local `photos` row for that report has `uploaded === false`
     - Skip if parent's `updated_at` is within last 30 minutes (regardless of `synced_at`)
   - Stamp `child_count_hint` on parent records during save (mentioned above)

7. **`src/lib/transaction-manager.ts`** — route rollback child deletes through tripwire with `context: { bulk: true, reason: 'transaction_rollback' }`

8. **`src/components/pwa/SyncDiagnosticsSheet.tsx`** — diagnostics
   - New row "Child-row deletions blocked (24 h)": queries `report_deleted_items` filtered by `reason = 'tripwire_blocked'` with `created_at >= now() - 24h`

### Files

- NEW: `src/lib/child-row-deletion-tripwire.ts`
- EDIT: `src/lib/sync-reconciliation.ts`
- EDIT: `src/lib/atomic-sync-manager.ts`
- EDIT: `src/lib/admin-edit-snapshot.ts`
- EDIT: `public/sw-sync.js`
- EDIT: `src/lib/offline-storage.ts`
- EDIT: `src/lib/transaction-manager.ts`
- EDIT: `src/components/pwa/SyncDiagnosticsSheet.tsx`

No DB migrations. No edge function changes. No new dependencies. `report_deleted_items` already supports the `reason` field via its `deleted_item_data` JSON column (will be stored there if no top-level column exists).

### Risk

Same as the originally approved plan: false-positive blocks mitigated by explicit `context.bulk = true` opt-out and the existing 3-cycle skip counter; tripwire adds one round-trip per child delete (rare event, acceptable); no save-path impact.

