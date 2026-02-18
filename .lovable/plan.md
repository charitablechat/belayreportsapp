

# Comprehensive Failure Mode Analysis: Report Data Lifecycle

## Audit Scope

Traced every write, read, delete, sync, and recovery path across the full persistence stack: React state, IndexedDB, localStorage backup ledger, WAL backups, service worker sync, and server-side upserts. All three report types (inspection, training, daily assessment) and their child data (systems, equipment, photos, etc.) were analyzed.

---

## Finding 1: `saveRelatedDataOffline` Uses Delete-Then-Insert Within a Single Transaction -- Partial Failure Leaves Orphaned State

**Risk: MEDIUM-HIGH**

**Location:** `src/lib/offline-storage.ts` lines 1008-1029

The `saveRelatedDataOffline` function performs a delete-all-then-put-all pattern inside a single IndexedDB transaction:
1. Reads all existing child records for the inspection
2. Deletes them all
3. Puts the new data

While this is wrapped in a single IDB transaction (which is atomic), the `idb` library uses microtask-based `.done` resolution. If the browser terminates the page after the deletes but before `tx.done` resolves, IndexedDB may commit the deletes but not all puts, depending on the browser's transaction commit semantics.

Additionally, if `performSave` calls 5 parallel `saveRelatedDataOffline()` calls (one per child type), each runs in a **separate** transaction. A page crash between transactions means some child stores are updated and others are stale -- e.g., systems saved but equipment still has the previous version.

The localStorage backup ledger partially mitigates this (it snapshots all children atomically), but the **emergency save snapshot uses React state refs** which may already be stale if the save was triggered by a state update that hasn't rendered yet.

**Proposed Fix:**
- After each successful `performSave`, verify the localStorage snapshot timestamp matches the IndexedDB write timestamp. If they diverge, trigger a corrective snapshot.
- Consider grouping all 5 child-store writes into a single multi-store IndexedDB transaction (IDB supports transactions spanning multiple stores).

---

## Finding 2: localStorage Backup Ledger Does Not Include Photos

**Risk: MEDIUM**

**Location:** `src/lib/local-backup-ledger.ts` (entire file), `src/pages/InspectionForm.tsx` lines 233-235

The `saveReportSnapshot` calls in all three forms save parent data and structured child data (systems, equipment, etc.), but **never include photo blobs or photo metadata**. The `ReportSnapshot.children` field contains arrays of systems/equipment/etc., but photos are stored separately in the `photos` IndexedDB store and are not part of the snapshot.

If IndexedDB is evicted by the browser (Finding 5 from previous audit), the localStorage backup preserves report text data but all local-only photos (unuploaded) are permanently lost. There is no recovery path.

**Proposed Fix:**
- Include photo metadata (IDs, captions, section, display_order -- but NOT blobs, which are too large for localStorage) in the backup snapshot under a `photo_metadata` key.
- When restoring from backup, use the metadata to flag which photos are missing so the user knows to re-capture them.

---

## Finding 3: Auth Token Expiry During Active Form Session Can Block Save

**Risk: MEDIUM**

**Location:** `src/pages/InspectionForm.tsx` lines 1134-1142, `src/lib/cached-auth.ts` lines 51-77

The `performSave` function calls `getUserWithCache()` as its first operation. The cache has a 1-minute TTL. If the user has been editing for more than 1 minute without any other auth-requiring operation, and the Supabase JWT has expired (default 1 hour), the following happens:

1. `getUserWithCache()` finds the cache expired
2. It tries `getCachedUserFromStorage()` (localStorage fallback) -- this succeeds
3. It returns the cached user, save proceeds

However, when `performSave` then tries to write to Supabase (online sync), the expired JWT causes a `401` error. The server write fails, but the local IndexedDB write has already succeeded (line 1237-1244 runs before the online sync at line 1286).

This is actually **safe** -- local data is preserved, and the background sync (`useAutoSync`) will retry with a refreshed token. But during the 401 window, the user sees a sync error toast that may cause confusion.

**Edge case:** If the user is offline when the JWT expires and comes back online, `ensureValidSession()` in the atomic sync manager (line 129) handles token refresh. But if the refresh itself fails (e.g., network hiccup), the sync is aborted and retried later.

**Proposed Fix:**
- No code change strictly needed (data is safe). Optionally, add a pre-emptive token refresh when `performSave` detects the session is within 5 minutes of expiry, to avoid the 401 error path entirely.

---

## Finding 4: WAL Backup (`report_backups` store) Prunes to 5 Entries -- Pre-Delete Backups Can Push Out More Recent Recovery Points

**Risk: LOW-MEDIUM**

**Location:** `src/lib/offline-storage.ts` lines 1690-1718

The `createReportBackup` function keeps a maximum of `MAX_BACKUPS_PER_REPORT` (5) entries per report. The backups are created at several trigger points:
- `deleteOfflineInspection` (pre-delete WAL)
- `deleteOfflineTraining` (pre-delete WAL)
- `deleteOfflinePhoto` (pre-delete WAL)
- `atomic-sync-manager.ts` pre-sync snapshot
- `atomic-sync-manager.ts` pre-delete (remote soft-delete detection)

If a report goes through rapid edit-sync cycles (e.g., 5 auto-saves in quick succession), the 5 backup slots fill up. The next pre-delete backup evicts the oldest recovery point. This means the user loses access to earlier versions that may have had more complete data.

**Proposed Fix:**
- Separate WAL backups (pre-delete snapshots) from version backups (pre-sync snapshots) using different `reportKey` prefixes. This ensures pre-delete backups never compete with version snapshots for the 5-slot limit.

---

## Finding 5: `saveRelatedDataOffline` Empty-Array Guard Blocks Legitimate Empty State

**Risk: LOW-MEDIUM**

**Location:** `src/lib/offline-storage.ts` lines 997-1001

The empty-array guard (`if (data.length === 0) return`) prevents saving empty arrays to protect against accidental data wipes. However, this also prevents a legitimate scenario: when a user intentionally deletes all systems/equipment from an inspection, the form sends an empty array, and the guard silently prevents the local cache from reflecting the user's action.

The stale child data persists in IndexedDB. On the next form load, the deleted items reappear, confusing the user.

**Proposed Fix:**
- Add an explicit `allowEmpty` option to `saveRelatedDataOffline` that the form can pass when the user has deliberately cleared all items. The guard should distinguish between "empty because IndexedDB read failed" and "empty because user deleted all items."

---

## Finding 6: No Recovery Path From localStorage Backup to IndexedDB

**Risk: LOW-MEDIUM**

**Location:** `src/lib/local-backup-ledger.ts` and `src/components/admin/DataRecoveryTool.tsx`

The `DataRecoveryTool` component allows exporting snapshots as JSON and restoring them to the server via `supabase.from().upsert()`. But there is **no automated path** to restore a localStorage snapshot back into IndexedDB. If IndexedDB is evicted but localStorage survives (a realistic scenario on iOS Safari), the user must:
1. Go to the admin panel
2. Find the snapshot in the data recovery tool
3. Export it as JSON
4. Manually re-import it (or wait for the next server fetch to repopulate IndexedDB)

During this gap, the form pages will show "Inspection not available offline" because they read from IndexedDB, not localStorage.

**Proposed Fix:**
- On form load, if IndexedDB returns `null` for a report but `getReportSnapshot()` finds a localStorage backup, automatically restore the backup into IndexedDB and proceed with form loading. This provides seamless recovery without user intervention.

---

## Finding 7: Service Worker Background Sync Bypasses localStorage Backup

**Risk: LOW**

**Location:** `public/sw-sync.js` (entire file)

The service worker syncs data directly from IndexedDB to the server. It never writes to the localStorage backup ledger. This means:
- If the SW syncs successfully and marks the record as synced in IndexedDB, but the localStorage backup is still marked `synced: false`, the backup ledger has stale sync status.
- If `markSnapshotSynced()` is never called from the main thread after a SW-initiated sync, the backup ledger incorrectly reports unsynced data.

This is a cosmetic issue (the data is safe on the server), but it can cause confusion in the DataRecoveryTool which shows "unsynced" badges based on the backup ledger's `synced` flag.

**Proposed Fix:**
- After the `useAutoSync` hook detects a successful background sync (via the `sync-complete` event), call `markSnapshotSynced()` for the synced reports.

---

## Finding 8: Concurrent `saveRelatedDataOffline` Calls for Same Inspection Can Interleave

**Risk: LOW**

**Location:** `src/lib/offline-storage.ts` lines 1008-1038

If `performSave` fires twice in rapid succession (e.g., mutex releases before the fire-and-forget `appendVersion` completes, and a user action triggers another save), two calls to `saveRelatedDataOffline('systems', id, ...)` can interleave. Both open separate read-write transactions on the same store. IndexedDB serializes transactions on the same store, so the second transaction waits for the first to complete. This is safe from a data integrity perspective, but the second transaction may delete the data written by the first and replace it with slightly different state.

The `anySaveInProgressRef` mutex (from Finding 2 of previous audit) prevents this for most cases, but fire-and-forget operations like `appendVersion` can release the mutex before all IndexedDB writes complete.

**Proposed Fix:**
- Already mitigated by the mutex. No additional fix needed unless `appendVersion` is changed to await before mutex release.

---

## Security Verification

- The localStorage backup ledger stores report field data (organization names, dates, inspector names, free-text comments). No API keys, tokens, or passwords are stored.
- The `ReportSnapshot` does not include `inspector_id` UUIDs in an exploitable format -- they are already visible in the DOM and network requests.
- The `rw_backup_` prefix keys in localStorage are accessible to any JavaScript running on the same origin. This is acceptable for a single-tenant PWA but would be a concern for multi-tenant shared-device scenarios.
- No credentials, JWTs, or secrets appear in the backup ledger or WAL backups.

---

## Summary Table

```text
+----+---------------------------------------------------+-----------+----------------------------------+
| #  | Finding                                           | Risk      | Location                         |
+----+---------------------------------------------------+-----------+----------------------------------+
| 1  | saveRelatedDataOffline delete-then-put across      | MED-HIGH  | offline-storage.ts:1008-1029     |
|    | separate transactions per child store              |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 2  | localStorage backup does not include photo         | MEDIUM    | local-backup-ledger.ts           |
|    | metadata                                           |           | InspectionForm.tsx:233           |
+----+---------------------------------------------------+-----------+----------------------------------+
| 3  | Auth token expiry shows spurious sync errors       | MEDIUM    | InspectionForm.tsx:1134          |
|    | (data is safe, UX issue only)                      |           | cached-auth.ts:51                |
+----+---------------------------------------------------+-----------+----------------------------------+
| 4  | WAL backup slot competition between pre-delete     | LOW-MED   | offline-storage.ts:1690-1718     |
|    | and version snapshots                              |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 5  | Empty-array guard blocks legitimate empty state    | LOW-MED   | offline-storage.ts:997-1001      |
+----+---------------------------------------------------+-----------+----------------------------------+
| 6  | No automatic recovery path from localStorage       | LOW-MED   | local-backup-ledger.ts           |
|    | backup to IndexedDB                                |           | Form pages (load functions)      |
+----+---------------------------------------------------+-----------+----------------------------------+
| 7  | SW background sync bypasses localStorage backup    | LOW       | sw-sync.js, useAutoSync.tsx      |
|    | ledger sync status                                 |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
| 8  | Concurrent saveRelatedDataOffline interleaving     | LOW       | offline-storage.ts:1008          |
|    | (already mitigated by mutex)                       |           |                                  |
+----+---------------------------------------------------+-----------+----------------------------------+
```

## Proposed Fixes (Priority Order)

| Priority | File | Changes |
|----------|------|---------|
| 1 | `src/lib/offline-storage.ts` | Add `allowEmpty` option to `saveRelatedDataOffline` and `saveAssessmentDataOffline` for deliberate user deletions |
| 2 | `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx` | On form load, check localStorage backup if IndexedDB returns null -- auto-restore into IndexedDB |
| 3 | `src/lib/local-backup-ledger.ts` | Add `photoMetadata` field to `ReportSnapshot` interface |
| 4 | All 3 form pages | Include photo IDs/captions in `saveReportSnapshot` calls (metadata only, no blobs) |
| 5 | `src/lib/offline-storage.ts` | Separate WAL backup keys: use `wal_` prefix for pre-delete backups vs `ver_` for version snapshots |
| 6 | `src/hooks/useAutoSync.tsx` | After successful sync, call `markSnapshotSynced()` to keep backup ledger in sync |
| 7 | `src/lib/cached-auth.ts` | Optional: add pre-emptive token refresh when session is within 5 minutes of expiry |

