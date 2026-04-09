

# Sync Engine Audit: Remaining Gaps and Broken Pieces

After a thorough review of `atomic-sync-manager.ts`, `useAutoSync.tsx`, `offline-storage.ts`, `sync-manager.ts`, `transaction-manager.ts`, `sync-reconciliation.ts`, `sw-sync.js`, and supporting files, here are the issues found:

---

## Bug 1 (HIGH): Service Worker upserts `inspector` join object to DB

**File:** `public/sw-sync.js`, lines 233-244, 519-529, 635-645

The main thread carefully strips joined objects before upsert:
```js
// atomic-sync-manager.ts
const { inspector, ...inspectionWithoutJoin } = inspection as any;
```

But the Service Worker does **not** strip these. It does `const inspData = { ...inspection }` and only deletes `synced_at`. If the IndexedDB record contains an `inspector` object (which it does -- line 649 saves it), the SW will try to upsert that nested object into the `inspections` table column, causing a PostgREST error or silent data corruption. Same for `trainer` on trainings.

**Fix:** Add `delete inspData.inspector;` (and `delete trainingData.inspector; delete trainingData.trainer;`, and `delete assessmentData.inspector;`) in the SW before upsert.

---

## Bug 2 (HIGH): Service Worker photo sync uses wrong storage path

**File:** `public/sw-sync.js`, lines 410-411

```js
const fileName = `${photo.inspectionId}/${Date.now()}.${fileExt}`;
```

The main thread's `syncPhotos()` uses `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}` (or the photo's pre-assigned `photoUrl`). The SW skips the user ID prefix entirely. Since storage bucket RLS requires paths to start with `auth.uid()`, the SW upload will fail silently or create files in an inaccessible path.

**Fix:** The SW should use `photo.photoUrl` if available (matching main thread), or skip photos without a pre-assigned path since the SW doesn't have access to the user ID reliably.

---

## Bug 3 (MEDIUM): Service Worker doesn't handle temp-ID inspections

**File:** `public/sw-sync.js`, lines 293-380

The main thread has elaborate temp-ID-to-UUID transformation and dedup guard logic. The SW has none. If the SW syncs a `temp-` prefixed inspection, it will:
- Send an invalid UUID to PostgREST, causing a `invalid input syntax for type uuid` error
- Or create a record with the temp-ID string in the `id` column (if the column type somehow accepts it)

This is documented in the memory as a known pattern, but the SW doesn't implement it.

**Fix:** Add a temp-ID check at the start of the SW sync loop: if `inspection.id.startsWith('temp-')`, skip it and let the main thread handle the ID transformation.

---

## Bug 4 (MEDIUM): `syncAllInspectionsAtomic` returns undefined for zero unsynced

**File:** `src/lib/atomic-sync-manager.ts`, lines 710-895

When `unsynced.length === 0`, the function falls through without an early return (unlike trainings at line 1538 and assessments at line 2244). The batch loop simply doesn't execute, and the function returns the result object at line 888. However, there's a missing early-return log statement.

Actually, looking more carefully, lines 795-803 emit progress even when batch is empty. This is minor but wasteful -- the progress emitter fires "Starting sync... (0 total pending)" with `total: 0`. Not a data bug, but inconsistent with trainings/assessments which return early.

**Fix:** Add the same early-return guard as trainings/assessments after `unsynced` is populated.

---

## Bug 5 (MEDIUM): Ownership check after temp-ID swap is dead code

**File:** `src/lib/atomic-sync-manager.ts`, line 177

```js
if (inspectionId.startsWith('temp-') || !inspection.synced_at) {
```

After the temp-ID swap at line 134-165, `inspectionId` is already replaced with the new UUID. So `inspectionId.startsWith('temp-')` will **never** be true at this point. The condition still works because `!inspection.synced_at` covers the same case, but the dead code is misleading.

Same pattern exists for trainings (line 985) and assessments (line 1701).

**Fix:** Remove the dead `startsWith('temp-')` check from all three ownership blocks.

---

## Bug 6 (LOW): SW photo sync doesn't check `storageBucket` or `tableName`

**File:** `public/sw-sync.js`, lines 406-461

The main thread `syncPhotos()` reads per-photo `storageBucket` and `tableName` metadata (lines in `sync-manager.ts`). The SW hardcodes `inspection-photos` bucket and `inspection_photos` table. Training photos or assessment photos stored with different bucket/table metadata will be uploaded to the wrong location.

**Fix:** Read `photo.storageBucket` and `photo.tableName` in the SW, with fallback to `inspection-photos`/`inspection_photos`.

---

## Bug 7 (LOW): Race between SW sync and main thread sync

Both the Service Worker (`sw-sync.js`) and main thread (`useAutoSync.tsx`) can sync the same record simultaneously. The SW has no coordination mechanism with the main thread's `syncInProgressRef`. This can cause:
- Duplicate child row insertions (mitigated by upsert, but generates unnecessary network traffic)
- Conflicting `synced_at` timestamps between SW and main thread stamps

The main thread does set `last_sync_source` to distinguish, and the `align_synced_at` RPC helps. But the SW doesn't call `align_synced_at`, so its timestamp may not match, causing the main thread to see the record as "unsynced" again on the next cycle.

**Fix:** Have the SW send a `SYNC_STARTING` message to clients before syncing, which the main thread can use to skip those records. Or simpler: have the SW only sync when no main thread client is active (`self.clients.matchAll()` returns empty).

---

## Summary of Fixes

| # | Severity | File | Issue | Fix |
|---|----------|------|-------|-----|
| 1 | HIGH | `sw-sync.js` | SW upserts joined `inspector`/`trainer` objects | Strip before upsert |
| 2 | HIGH | `sw-sync.js` | SW photo path missing user ID prefix | Use `photo.photoUrl` or skip |
| 3 | MEDIUM | `sw-sync.js` | SW doesn't skip temp-ID records | Add `temp-` guard |
| 4 | MEDIUM | `atomic-sync-manager.ts` | Missing early-return for empty inspections | Add guard like trainings |
| 5 | MEDIUM | `atomic-sync-manager.ts` | Dead `startsWith('temp-')` after ID swap | Remove dead code |
| 6 | LOW | `sw-sync.js` | SW hardcodes photo bucket/table | Read from photo metadata |
| 7 | LOW | `sw-sync.js` | No SW/main-thread sync coordination | Skip sync when client active |

The main thread sync engine (`atomic-sync-manager.ts`, `useAutoSync.tsx`) is now solid after the recent fixes. The biggest remaining risk area is the **Service Worker** (`sw-sync.js`), which has diverged from the main thread's safety guards and can cause silent data issues.

