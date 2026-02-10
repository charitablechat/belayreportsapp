

# Fix: Systems/Ziplines Data Loss During Online and Offline Save

## Why It Is Still Happening

The recent fix correctly saves ALL items (including empty-name rows) to IndexedDB. However, **the online server sync path still filters them out**. Here is the exact failure sequence:

1. User adds system rows -- they start with empty `system_name`
2. Auto-save fires (1.5s debounce) while user is still typing names
3. IndexedDB now has all rows (good -- recent fix works)
4. Online sync runs in the same `performSave` call and sends only `validSystems` (rows with non-empty names) to the database -- **this is still 0 rows if names haven't been filled yet**
5. `synced_at` is set to now, `updated_at` is set to match (`synced_at = updated_at`)
6. User fills in names, triggering another debounce cycle
7. Next auto-save fires -- but the online sync for systems only sends rows whose names are filled. If the user navigated away or the debounce was killed, the server still has 0 systems
8. On next page load while online, server data (0 systems) is treated as authoritative because `synced_at >= updated_at`

The atomic sync manager (background sync) does NOT filter by name and would correctly send everything -- but it never gets a chance because the record is already marked as fully synced.

## The Fix (2 files)

### 1. `src/pages/InspectionForm.tsx` -- Stop filtering systems/ziplines/equipment for the online sync path

The `validSystems`, `validZiplines`, and `validEquipment` filters should ONLY be used for display/reporting purposes, never for persistence. The online sync path should send ALL items to the database, matching what the atomic sync manager already does.

Changes:
- Replace all references to `validSystems` with `systems` in the server sync operations (lines 1197-1270)
- Replace all references to `validZiplines` with `ziplines` in the server sync operations (lines 1272-1301)
- Replace all references to `validEquipment` with `equipment` in the server sync operations (lines 1304-1333)
- Keep the filter definitions for DEV logging only (useful for diagnostics)
- Add pre-sync ID transformation (temp- to UUID) directly on the unfiltered arrays instead of the filtered ones

### 2. `src/pages/InspectionForm.tsx` -- Prevent `synced_at = updated_at` alignment when items were incomplete

After the online sync completes, do NOT align `updated_at` to match `synced_at` if any systems/ziplines had empty names at save time. This ensures the background sync will pick up the record again once names are filled in.

Change at line 1349-1353:
- Only set `updated_at = synced_at` if the save had no filtered-out items
- Otherwise, keep the original `updated_at` so the record remains "newer than synced" and gets re-synced

## Technical Details

### File: `src/pages/InspectionForm.tsx`

**Change 1 -- Use unfiltered arrays for server sync (lines 1197-1333)**

Replace:
```
const existingSystems = validSystems.filter(s => s.id && !s.id.startsWith('temp-'));
const newSystems = validSystems.filter(s => !s.id || s.id.startsWith('temp-')).map(...)
```

With:
```
const existingSystems = systems.filter(s => s.id && !s.id.startsWith('temp-'));
const newSystems = systems.filter(s => !s.id || s.id.startsWith('temp-')).map(...)
```

Same pattern for ziplines and equipment.

**Change 2 -- Conditional timestamp alignment (lines 1348-1353)**

Replace:
```
await saveInspectionOffline({
  ...inspectionToSave,
  synced_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
```

With:
```
const hadFilteredItems = validSystems.length !== systems.length 
  || validZiplines.length !== ziplines.length
  || validEquipment.length !== equipment.length;

const syncTimestamp = new Date().toISOString();
await saveInspectionOffline({
  ...inspectionToSave,
  synced_at: syncTimestamp,
  updated_at: hadFilteredItems ? inspectionToSave.updated_at : syncTimestamp,
});
```

## What This Achieves

- ALL data entered by the user is sent to the database immediately during online saves -- no silent filtering
- Empty-name rows are preserved in the database (the schema allows `system_name` to be null/optional)
- If rows had empty names at save time, the record stays flagged for re-sync so the background sync will push updated names later
- The atomic sync manager (offline path) continues working as before -- no changes needed there

## Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Use unfiltered arrays for server sync; conditional timestamp alignment |

