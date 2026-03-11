

## Analysis: JSON Import → Save Progress Flow

### Investigation Summary

I traced the complete data flow from JSON import through Save Progress across all three form types. The import handler (`handleReportImported`) added in the previous fix correctly reloads data from IndexedDB into React state, but there are **two concrete gaps** that cause the Save Progress button to either silently fail or not function at all after an import.

---

### Gap 1: Missing `setInspectorId` in Import Handler (Critical)

**InspectionForm.tsx, line 1259–1265**

Every data-loading path in the form calls `setInspectorId(data.inspector_id)`:
- Offline load (line 877)
- Backup restore (line 891)
- Server load (lines 1100, 1114)

But the import handler **does not**. The `inspectorId` state feeds into `useReportEditPermission`, which derives `isOwner` and `isReadOnly`. If `inspectorId` is stale or null (e.g., the form loaded a different report first, or the import changes the inspector), `effectiveReadOnly` becomes `true`, and the Save Progress button is **hidden entirely** (line 2518: `{!effectiveReadOnly && (`).

Even when the button remains visible, `isOwner` being `false` prevents the auto-save change tracker from firing (line 538: `if (!loading && !isInternalUpdateRef.current && isOwner)`), which means subsequent edits after import won't trigger auto-save either.

The same gap exists in **TrainingForm** and **DailyAssessmentForm** — wherever an equivalent owner/permission check is derived from parent state but not updated by the import handler.

### Gap 2: `hasUnsavedChanges` Set to `false` Prematurely

**All three forms, in `handleReportImported`**

After import, `setHasUnsavedChanges(false)` is called (line 1267). While the data IS persisted in IndexedDB, it has **not yet been synced to the server**. This means:

- The interval-based auto-save (line 564: `if (hasUnsavedChanges && ...)`) won't fire
- The user sees no visual indication that server sync is needed
- If they close the form without clicking Save Progress, the data sits only in IndexedDB until the next background sync cycle (30 minutes)

The imported data should be treated as "unsaved" from the server's perspective so that clicking Save Progress triggers a full server sync.

---

### Proposed Fix

**`src/pages/InspectionForm.tsx`** — In the `handleReportImported` handler:
1. Add `setInspectorId(offlineData.inspector_id)` after `setInspection(offlineData)` — aligns with every other loading path
2. Change `setHasUnsavedChanges(false)` → `setHasUnsavedChanges(true)` — ensures the imported data gets synced to the server on next save

**`src/pages/TrainingForm.tsx`** — Same pattern:
1. Add the equivalent owner/permission state update after setting the parent record
2. Change `setHasUnsavedChanges(false)` → `setHasUnsavedChanges(true)`

**`src/pages/DailyAssessmentForm.tsx`** — Same pattern:
1. Add the equivalent owner/permission state update
2. Change `setHasUnsavedChanges(false)` → `setHasUnsavedChanges(true)`

### What stays the same
- `isInternalUpdateRef.current = true` — correctly prevents the change tracker from double-firing during the state update
- `childDataLoadedRef` updates — correctly marks child data as loaded to prevent regression guards from blocking saves
- Import flow in `local-backup-ledger.ts` — no changes needed
- `performSave` logic — works correctly once it has the right state

