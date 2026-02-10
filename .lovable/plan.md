

# Technical Report: Systems/Ziplines Sync Failure

## Diagnosis: Why It Failed

### Confirmed Evidence

Database state for inspection `06d59d44-c8ee-496d-8ec4-ff78b72a1014`:
- **Systems: 0, Ziplines: 0** (data lost)
- Equipment: 16, Standards: 6, Summary: 1 (intact)
- `synced_at: 2026-02-10 23:38:59` (inspection was marked as fully synced)
- `updated_at: 2026-02-10 23:39:53` (modified after sync)

### Root Cause: Silent Data Exclusion During Save

The `performSave` function in `InspectionForm.tsx` (line 1098-1102) applies a validation filter before saving:

```text
validSystems = systems.filter(s => s.system_name && s.system_name.trim() !== "")
validZiplines = ziplines.filter(z => z.zipline_name && z.zipline_name.trim() !== "")
```

If the `system_name` or `zipline_name` field is `null`, `undefined`, or an empty string at the moment of save, those entries are **silently excluded** from both the IndexedDB write and the server sync. The rest of the save proceeds normally and the inspection is marked as synced (`synced_at` is set), creating the false impression that all data was committed.

This happens because:
1. The online sync path (line 1204-1319) only pushes upsert/insert operations for items that pass the filter
2. If `validSystems` is empty, **zero operations** are sent for systems -- no insert, no upsert
3. The inspection is still marked as synced at line 1322 regardless
4. Any subsequent page reload while online pulls server data (0 systems) and overwrites the IndexedDB cache

### Contributing Factor: `useBlocker` Interaction

The recently added `useUnsavedChanges` hook uses `useBlocker` to prevent navigation when `hasUnsavedChanges` is true. When the user confirms "Leave Page", the component unmounts and the pending 1.5-second auto-save debounce timer is killed. If the last batch of edits (setting `system_name` to a valid value) was within the debounce window, the data never reaches `performSave`.

Timeline of failure:
1. User adds system/zipline rows (entries created with empty `system_name`)
2. Auto-save fires during this time -- saves inspection with `validSystems = []` (filtered out)
3. User fills in the `system_name` values
4. 1.5s debounce starts
5. User navigates away before debounce completes
6. `useBlocker` dialog appears, user clicks "Leave Page"
7. Debounce timer cleared, data never saved
8. Inspection already marked as synced with 0 systems

### Contributing Factor: Fire-and-Forget Local Save

The IndexedDB save at line 1122 is intentionally not awaited (fire-and-forget). While this improves UI responsiveness, it means:
- The server sync can begin before IndexedDB has the latest data
- If the server sync marks the record as synced, the `localIsNewer` guard on reload sees server data as authoritative
- Local-only child data gets overwritten by empty server data

## Immediate Action: Recover Current Data

### Step 1: Manual Data Recovery

The systems and ziplines data for this inspection must be re-entered by the user, as the data was never committed to either IndexedDB or the database. There is no backup to recover from since the data only existed in React state.

### Step 2: Code Fixes (4 files)

**File 1: `src/pages/InspectionForm.tsx` -- Save-before-leave**

Modify the `UnsavedChangesDialog` integration to trigger an immediate save before confirming navigation. Change the `confirmNavigation` flow:

- When user clicks "Leave Page", first flush any pending debounce timer and run `performSave(true)` (silent mode)
- Only call `blocker.proceed()` after the save completes (or times out after 3 seconds)
- This ensures the last batch of edits always reaches IndexedDB before unmount

**File 2: `src/pages/InspectionForm.tsx` -- Await local save before server sync**

Change the fire-and-forget IndexedDB save at line 1122 to be awaited (or at minimum, awaited before the server sync begins). This ensures IndexedDB always has the latest data before the inspection is marked as synced.

```text
// BEFORE (fire-and-forget):
Promise.all([saveInspectionOffline(...), saveRelatedDataOffline(...)]).then(...)

// AFTER (awaited):
await Promise.all([saveInspectionOffline(...), saveRelatedDataOffline(...)])
```

**File 3: `src/pages/InspectionForm.tsx` -- Include all rows in local save, filter only for server**

Split the filtering logic:
- IndexedDB save: Save ALL items (including those with empty names) -- preserves work-in-progress data
- Server sync: Continue filtering to only valid items (prevents DB constraint violations)

This prevents the scenario where a user adds rows, hasn't filled names yet, auto-save deletes the rows from IndexedDB, and the data is lost.

**File 4: `src/components/UnsavedChangesDialog.tsx` -- Add "Save and Leave" option**

Add a third button to the dialog: "Save and Leave" which triggers a save before proceeding with navigation. The existing "Leave Page" button remains for explicit abandon.

## Long-Term Strategy: Prevention Plan

### 1. Robust Save Guarantees

- **Await critical local saves**: The IndexedDB write must complete before any server sync or sync-status marking
- **Save-on-unmount**: Add a `useEffect` cleanup that flushes pending saves when the component unmounts (belt-and-suspenders with the blocker save)
- **Separate filters for local vs remote**: Local IndexedDB stores all data (including incomplete rows); only the server sync filters for validity

### 2. Explicit Sync Logging

- Add a sync audit entry each time `performSave` runs, recording: item counts per category (systems, ziplines, equipment, standards), filtered-out counts, and whether the save was silent/manual
- Log these to the existing Notification Center so the user can review what was saved
- In DEV mode, add console warnings when `validSystems.length !== systems.length` to flag filtered-out items

### 3. Audit Scope Integration

This investigation confirms a broader pattern: the fire-and-forget save pattern and silent filtering can cause data loss across all form types. The remediation should be applied to:

- `TrainingForm.tsx` -- check for similar filtering patterns on delivery approaches, operating systems
- `DailyAssessmentForm.tsx` -- check for similar patterns on equipment checks, structure checks
- All three forms should implement save-before-leave via the `useBlocker` integration

## Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Save-before-leave on blocker confirm; await local save; split filters for local vs server |
| `src/components/UnsavedChangesDialog.tsx` | Add "Save and Leave" button option |
| `src/hooks/useUnsavedChanges.tsx` | Add `onSaveAndLeave` callback support |

