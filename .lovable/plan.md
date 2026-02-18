

# Fix: Prevent Dashboard Server-Cache from Overwriting Unsynced Local Data

## Root Cause Analysis

The Rocky River Ranch data loss was caused by a **destructive cache-write pattern** in `Dashboard.tsx`. Here is the exact sequence:

1. Luke enters inspection data on mobile. Data is saved to IndexedDB with `synced_at = null` (never synced to server).
2. The sync pipeline fails silently (validation block, network timeout, or session issue). The parent record reaches the server but child data (systems, equipment, photos) does not.
3. Luke returns to the Dashboard while online (or auto-sync triggers a dashboard reload).
4. The Dashboard fetches the inspection from the server -- the parent record exists but has **empty child data**.
5. **THE BUG (Line 381):** The Dashboard blindly overwrites the local IndexedDB record:
   ```
   saveInspectionOffline({ ...serverData, synced_at: serverData.synced_at || now })
   ```
   This stamps `synced_at = now` on the local record, destroying the `synced_at = null` signal that marked it as unsynced.
6. Later, when the InspectionForm opens, `isLocalDataNewer()` sees `synced_at` is set and `updated_at` matches the server -- so it trusts the server data and overwrites local child data (systems, equipment, etc.) with empty arrays from the server.
7. **All locally-entered data is gone.**

The same vulnerability exists in all three report types: inspections (line 381), trainings (line 503), and daily assessments (line 622).

## Fix

Add an **unsynced-data guard** to the Dashboard's cache-write path. Before overwriting any local record with server data, check if the local version has unsynced changes. If it does, **skip the overwrite** to preserve the local data.

## Technical Details

### 1. New utility function: `src/lib/local-data-guards.ts`

Add a new function `shouldPreserveLocalRecord` that checks whether a local IndexedDB record should be protected from server overwrites:

```typescript
export function shouldPreserveLocalRecord(
  localRecord: { synced_at?: string | null; updated_at?: string | null } | null | undefined
): boolean {
  if (!localRecord) return false;
  // Never synced -- local data is the only copy
  if (!localRecord.synced_at) return true;
  // Local changes made after last sync
  if (localRecord.updated_at && localRecord.synced_at &&
      new Date(localRecord.updated_at) > new Date(localRecord.synced_at)) {
    return true;
  }
  return false;
}
```

### 2. File: `src/pages/Dashboard.tsx` -- Three changes

**Inspections cache save (around line 378-381):**
Before batch-saving server data to IndexedDB, read each local record first. If the local version has unsynced changes, skip the overwrite for that specific record.

```typescript
// Before:
Promise.all(networkData.map(inspection =>
  saveInspectionOffline({ ...inspection, synced_at: inspection.synced_at || now })
))

// After:
Promise.all(networkData.map(async (inspection) => {
  const localRecord = await getOfflineInspection(inspection.id);
  if (shouldPreserveLocalRecord(localRecord)) {
    console.log('[Dashboard] Preserving unsynced local inspection:', inspection.id);
    return; // Skip -- local data is newer/unsynced
  }
  return saveInspectionOffline({ ...inspection, synced_at: inspection.synced_at || now });
}))
```

Apply the identical pattern to:
- **Trainings cache save (around line 502-503):** Same guard using `getOfflineTraining` 
- **Daily assessments cache save (around line 621-622):** Same guard using `getOfflineDailyAssessment`

### 3. New imports needed in Dashboard.tsx

```typescript
import { getOfflineInspection, getOfflineTraining, getOfflineDailyAssessment } from '@/lib/offline-storage';
import { shouldPreserveLocalRecord } from '@/lib/local-data-guards';
```

(Note: `getOfflineInspection` is already available in offline-storage.ts. `getOfflineTraining` and `getOfflineDailyAssessment` need to be verified -- they exist as `getOfflineTraining` at line ~900 and `getOfflineDailyAssessment` at line ~1200 of offline-storage.ts.)

## Impact

- **Scope:** Dashboard.tsx cache-write path only -- no changes to sync pipeline, form logic, or IndexedDB schema
- **Risk:** Low. The only behavioral change is that unsynced local records are no longer overwritten. The sync pipeline will eventually push local data to the server, at which point future dashboard loads will cache normally.
- **Covers all report types:** Inspections, trainings, and daily assessments all get the same protection
- **No performance impact:** `getOfflineInspection` is a single IndexedDB key lookup (sub-millisecond)

## What This Prevents

- Local data being overwritten by empty/stale server data during dashboard refresh
- The `synced_at` timestamp being falsely stamped on records that never actually synced
- The `isLocalDataNewer` guard being bypassed due to corrupted timestamps
- Any future data loss from the same mechanism, for any report type, for any user

