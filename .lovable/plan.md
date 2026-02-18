

# Audit: Remaining Data Loss Vectors

After a thorough code review across all form pages, sync managers, offline storage, and dashboard logic, I identified **7 remaining gaps** where inputted data can still be lost.

---

## Finding 1: Pre-Sync Version Snapshot Missing for Trainings and Daily Assessments

**Risk: HIGH**

The `syncInspectionAtomic()` function (line 312-333 of `atomic-sync-manager.ts`) includes both a **pre-sync version snapshot** (`appendVersion`) and a **field-count regression guard** that blocks sync if data drops by more than 50%. However, `syncTrainingAtomic()` and `syncDailyAssessmentAtomic()` have **neither of these safeguards**.

This means a training or daily assessment with corrupted/empty IndexedDB data can sync to the server and overwrite valid server data with empty child records -- the exact scenario the guards were designed to prevent.

**Fix:** Add the same `appendVersion()` call and `calculateFieldCount`/`getLatestFieldCount` regression check to `syncTrainingAtomic()` (before line 871) and `syncDailyAssessmentAtomic()` (before line 1339) in `atomic-sync-manager.ts`.

---

## Finding 2: `isInternalUpdateRef` Reset Has No Dependency Array (TrainingForm)

**Risk: MEDIUM**

In `TrainingForm.tsx` (line 706-710), the `useEffect` that resets `isInternalUpdateRef.current = false` has **no dependency array**:
```typescript
useEffect(() => {
  if (isInternalUpdateRef.current) {
    isInternalUpdateRef.current = false;
  }
}); // <-- runs on EVERY render
```

In `InspectionForm.tsx`, the equivalent effect correctly depends on `[systems, ziplines, equipment, standards, summary]`. The TrainingForm's version runs on every render, meaning it can reset the flag prematurely before the auto-save watcher (which depends on the same state) has a chance to read it. This creates a race condition where a programmatic update (e.g., server data hydration) is incorrectly treated as a user edit, triggering an unnecessary auto-save that can overwrite the loaded data.

**Fix:** Add the correct dependency array to the TrainingForm reset effect:
```typescript
useEffect(() => {
  if (isInternalUpdateRef.current) {
    isInternalUpdateRef.current = false;
  }
}, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]);
```
Verify `DailyAssessmentForm.tsx` has the same pattern.

---

## Finding 3: `handleHeaderUpdate` Writes Directly to Server Without Save Mutex

**Risk: MEDIUM**

In `InspectionForm.tsx` (line 719-765), `handleHeaderUpdate` performs an immediate server write (`supabase.from("inspections").update(...)`) **outside** the `performSave` function and without checking `anySaveInProgressRef`. If a user changes a header field (organization, location) while an auto-save is in flight, two concurrent writes can race:

1. Auto-save writes the full inspection object with the old header value
2. `handleHeaderUpdate` writes just the single header field

The auto-save's `updated_at` may be older than `handleHeaderUpdate`'s, causing the server to end up with mixed state. More critically, the `saveInspectionOffline` call inside `handleHeaderUpdate` (line 730) saves the inspection object **without the latest child data state**, meaning the next auto-save may read a stale inspection from IndexedDB.

**Fix:** Route header updates through the same debounced save path instead of bypassing it. Or at minimum, add `anySaveInProgressRef` check and await any in-flight save before proceeding.

---

## Finding 4: Server-Deleted Records Delete Local Data Without Backup

**Risk: MEDIUM**

In `atomic-sync-manager.ts`, when a remote record is detected as soft-deleted (lines 227-244, 840-856, 1308-1324), the local IndexedDB copy is immediately deleted via `deleteOfflineInspection`/`deleteOfflineTraining`/`deleteOfflineDailyAssessment` **without first creating a backup or version snapshot**.

If a super admin accidentally soft-deletes a report, the user's local data is silently destroyed during the next sync cycle. The localStorage backup ledger might have a snapshot, but it is not guaranteed to be current (it only updates on saves, not on sync).

**Fix:** Before calling `deleteOffline*` in these blocks, call `appendVersion()` with trigger `'pre_delete'` and `saveReportSnapshot()` to ensure the data is recoverable from both version history and the localStorage ledger.

---

## Finding 5: Orphan Cleanup Deletes Child Data Without Cleanup

**Risk: LOW-MEDIUM**

When the Dashboard orphan cleanup removes a local inspection/training/assessment (e.g., line 439: `deleteOfflineInspection(local.id)`), it only deletes the **parent record** from IndexedDB. The child records (systems, equipment, ziplines, etc.) remain orphaned in their respective object stores, consuming storage.

More importantly, if the parent is later re-fetched from the server (e.g., user goes online), the orphaned child data from IndexedDB will be loaded and could conflict with fresh server data, causing duplicate or stale rows.

**Fix:** When deleting an orphaned parent, also clear its child stores. Add calls like:
```typescript
await clearRelatedDataOffline('systems', local.id);
await clearRelatedDataOffline('ziplines', local.id);
// etc.
```
Note: `clearRelatedDataOffline` currently blocks non-temp IDs (safety guard). This guard needs a new bypass parameter for orphan cleanup specifically.

---

## Finding 6: `withTimeout` Fallback Silently Returns Empty Data

**Risk: LOW-MEDIUM**

The `withTimeout` helper in `offline-storage.ts` (line 257-262) resolves with `fallbackValue` on timeout instead of rejecting. This means when IndexedDB is slow (common on mobile under memory pressure), operations like `getOfflineInspection` silently return `null` and `getRelatedDataOffline` silently returns `[]`.

In `InspectionForm.loadInspection()`, if IndexedDB times out, `offlineSystems` etc. are `[]`. Then if the server also returns empty (e.g., RLS issue), the form loads with no data. The non-regression guard (Vector 2) only protects server-empty-vs-local-has-data, but if **both** are empty due to timeout, data appears lost.

**Fix:** Track whether the offline load actually completed vs. timed out. If it timed out, log a warning and potentially retry once before proceeding with server-only data. At minimum, never run the "server empty, local empty" path if the offline load timed out.

---

## Finding 7: `deleteOfflineInspection` Has No WAL Backup Guard

**Risk: LOW**

The plan called for `report_backups` (WAL) to snapshot data before any destructive IndexedDB operation. However, `deleteOfflineInspection`, `deleteOfflineTraining`, and `deleteOfflineDailyAssessment` (lines 618-631, 1081-1090, 1356-1365 of `offline-storage.ts`) perform a raw `db.delete()` without any pre-delete backup. The `createReportBackup` function exists but is never called before these deletes.

**Fix:** Before each `db.delete()` call, read the current record and write it to the `report_backups` store. This provides a last-resort recovery path within IndexedDB itself.

---

## Summary Table

```text
+----+------------------------------------------------+--------+-------------------------------+
| #  | Vector                                         | Risk   | Fix Location                  |
+----+------------------------------------------------+--------+-------------------------------+
| 1  | No pre-sync snapshot/regression guard for       | HIGH   | atomic-sync-manager.ts        |
|    | trainings and daily assessments                 |        | (syncTrainingAtomic,          |
|    |                                                 |        |  syncDailyAssessmentAtomic)   |
+----+------------------------------------------------+--------+-------------------------------+
| 2  | isInternalUpdateRef reset runs every render      | MEDIUM | TrainingForm.tsx (line 706)   |
|    | (missing dependency array)                       |        | DailyAssessmentForm.tsx       |
+----+------------------------------------------------+--------+-------------------------------+
| 3  | handleHeaderUpdate bypasses save mutex            | MEDIUM | InspectionForm.tsx (line 719) |
+----+------------------------------------------------+--------+-------------------------------+
| 4  | Server-deleted records destroy local data         | MEDIUM | atomic-sync-manager.ts        |
|    | without backup                                   |        | (3 locations)                 |
+----+------------------------------------------------+--------+-------------------------------+
| 5  | Orphan cleanup leaves child data orphaned         | LOW-   | Dashboard.tsx (3 cleanup      |
|    |                                                  | MED    | blocks)                       |
+----+------------------------------------------------+--------+-------------------------------+
| 6  | IndexedDB timeout silently returns empty data     | LOW-   | InspectionForm.tsx,           |
|    |                                                  | MED    | offline-storage.ts            |
+----+------------------------------------------------+--------+-------------------------------+
| 7  | deleteOffline* has no WAL backup                  | LOW    | offline-storage.ts            |
+----+------------------------------------------------+--------+-------------------------------+
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/atomic-sync-manager.ts` | Add pre-sync snapshot + regression guard to training and assessment sync; add pre-delete backup before local cleanup of server-deleted records |
| `src/pages/TrainingForm.tsx` | Fix `isInternalUpdateRef` reset dependency array |
| `src/pages/DailyAssessmentForm.tsx` | Verify/fix same dependency array issue |
| `src/pages/InspectionForm.tsx` | Add mutex check to `handleHeaderUpdate` |
| `src/pages/Dashboard.tsx` | Add child data cleanup to orphan removal blocks; add `clearRelatedDataOffline` bypass for non-temp orphans |
| `src/lib/offline-storage.ts` | Add WAL backup before `deleteOffline*` calls; add timeout-aware flag to `withTimeout`; add orphan-cleanup bypass to `clearRelatedDataOffline` |

## Security

- No API keys, secrets, or credentials are involved in any of these changes
- All fixes operate on client-side storage (IndexedDB, localStorage) and React state
- No new server-side calls or database schema changes required

