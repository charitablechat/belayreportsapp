

## Audit: JSON Import → Save Progress Data Loss

### Root Cause

When a user imports a JSON backup file while the InspectionForm (or any form) is already open, the import writes data to IndexedDB and localStorage, but the **React state** in the form component is never refreshed. When the user then clicks "Save Progress", `performSave()` writes the stale React state back to IndexedDB and the server, **overwriting the imported data**.

```text
Timeline:
  1. Form loads → React state populated from IndexedDB/server
  2. User opens Data Recovery sheet → imports JSON
  3. importReportBackup() writes to IndexedDB + localStorage ✓
  4. User closes sheet → React state still has OLD data
  5. User clicks "Save Progress" → performSave() writes OLD React state
     → IndexedDB overwritten with old data ✗
     → Server synced with old data ✗
     → Imported JSON data LOST ✗
```

### Secondary Gap: Auto-save races

Even without clicking "Save Progress", the auto-save (1.5s debounce or 10s interval) will fire and overwrite the imported data with stale React state. The emergency save on `visibilitychange` has the same issue.

### Fix

**`src/lib/local-backup-ledger.ts`** — Add a global event mechanism:
- After `importReportBackup()` completes successfully, dispatch a custom DOM event `report-data-imported` with `{ reportType, reportId }` as detail.

**`src/pages/InspectionForm.tsx`** — Listen for the import event:
- Add a `useEffect` that listens for the `report-data-imported` custom event.
- When received, if the `reportId` matches the current form's `id`, reload data from IndexedDB into React state (reuse the existing offline-loading logic). This ensures the form picks up the imported data.
- Set `childDataLoadedRef` flags to `true` for all child types.
- Set `hasUnsavedChanges` to `false` (data is already persisted in IndexedDB).

**`src/pages/TrainingForm.tsx`** — Same pattern: listen for import event, reload from IndexedDB if matching.

**`src/pages/DailyAssessmentForm.tsx`** — Same pattern.

### Changes Summary

1. **`src/lib/local-backup-ledger.ts`** (~3 lines): At the end of `importReportBackup()`, after all writes complete, dispatch:
   ```ts
   window.dispatchEvent(new CustomEvent('report-data-imported', {
     detail: { reportType, reportId }
   }));
   ```

2. **`src/pages/InspectionForm.tsx`** (~40 lines): Add `useEffect` listening for the event. When the imported report matches the current form ID, re-read all child data from IndexedDB using the existing `getOfflineInspection`/`getRelatedDataOffline` calls and update React state (systems, ziplines, equipment, standards, summary). Mark all `childDataLoadedRef` flags as `true`.

3. **`src/pages/TrainingForm.tsx`** (~30 lines): Same pattern adapted for training data structures.

4. **`src/pages/DailyAssessmentForm.tsx`** (~30 lines): Same pattern adapted for assessment data structures.

### What stays the same
- Auto-save, emergency save, manual save logic unchanged
- Import flow in DataRecoveryTool unchanged
- No new dependencies

