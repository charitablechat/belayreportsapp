

# Prevent Equipment Data Loss on Load + Recover Twin Cedars Data - v2.4.16

## Problem

When a report has unsynced local changes (`synced_at` is NULL) and the user opens the form while online, the `loadInspection` function:
1. Loads data from IndexedDB first (correct)
2. Fetches data from the database (correct)
3. **Unconditionally overwrites local state with server data** (BUG on lines 888-898)

This means any equipment items saved locally but not yet synced to the server are silently erased when the server returns its (stale) version.

## Root Cause (src/pages/InspectionForm.tsx, lines 858-917)

The server data fetch does not check whether local data is **newer** than server data. It blindly calls `setEquipment(normalizedEquipment)`, `setSystems(normalizedSystems)`, etc., replacing whatever was loaded from IndexedDB — even if the local copy has more recent, unsynced changes.

## Solution

### 1. Smart merge on load: prefer local data when unsynced (src/pages/InspectionForm.tsx)

After fetching server data, compare `updated_at` timestamps between the offline inspection and the server inspection. If the local version is newer (or `synced_at` is NULL), **keep the local related data** instead of overwriting it with server data.

```text
Logic:
  localInspection = from IndexedDB
  serverInspection = from database

  if (localInspection exists AND localInspection.updated_at > serverInspection.updated_at) OR
     (localInspection exists AND localInspection.synced_at is NULL):
    - Keep locally loaded systems/equipment/ziplines/standards/summary
    - Still update the inspection header from server (for metadata like status)
    - Cache server data as "server_baseline" but don't apply to state
  else:
    - Apply server data as before (current behavior)
```

This affects the block from approximately line 858 to line 917 where all related data is processed after the database fetch.

### 2. Add "Local Data Recovery" button to the Equipment section

Add a small "Recover from device" action that reads IndexedDB directly and merges any items not present in the current equipment list (matched by ID). This gives users a manual recovery path.

### 3. Recover the Twin Cedars data

The belay and trolley data should still exist in IndexedDB on the original device. The fix above will prevent this from being overwritten in the future. For immediate recovery:
- The Admin Data Recovery Tool (already built) can extract IndexedDB contents
- Once the code fix is deployed, opening the Twin Cedars report from the original device should load the local data correctly

### 4. Version bump

Bump to v2.4.16.

## Technical Details

### File: src/pages/InspectionForm.tsx

**Change 1 — Smart merge in loadInspection (around line 858)**

Before processing server-fetched related data, add a guard:

```typescript
// Determine if local data should take priority
const localIsNewer = offlineData && (
  !offlineData.synced_at || // Never synced = local has unsynced changes
  (offlineData.updated_at && data?.updated_at && 
   new Date(offlineData.updated_at) > new Date(data.updated_at))
);

if (localIsNewer) {
  // Local data is newer - don't overwrite state with server data
  // But still cache server data for conflict detection
  console.log('[InspectionForm] Local data is newer than server - preserving local state');
  
  // Only update the inspection header metadata (status, etc.) from server
  if (data) {
    setInspection(prev => ({
      ...prev,
      // Keep local field values, but accept server metadata
      status: data.status,
      inspector: data.inspector,
    }));
    setInspectorId(data.inspector_id);
  }
  
  // Trigger a sync to push local data to server
  // (handled by useAutoSync, but we can hint it)
} else {
  // Server data is current - apply it (existing behavior)
  // ... existing code for processing systemsData, equipmentData, etc.
}
```

**Change 2 — Also protect the offline cache from being overwritten by stale server data**

When `localIsNewer` is true, skip the `saveRelatedDataOffline()` calls that would overwrite the local IndexedDB with the server's stale data.

### File: vite.config.ts
- Bump to v2.4.16

## Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add local-vs-server freshness check in `loadInspection`; skip server overwrite when local is newer |
| `vite.config.ts` | Bump to v2.4.16 |

## Impact

- Prevents data loss when opening a report with unsynced local changes while online
- Preserves existing behavior when server data is current (majority of cases)
- Does not change save/sync logic — only the **load** path is affected
- The Twin Cedars belay/trolley data should be recoverable if the user opens the report from the original device after this fix is deployed

