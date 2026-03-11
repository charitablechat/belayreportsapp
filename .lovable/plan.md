

## Root Cause: No localStorage Snapshot Until First Save

### Diagnosis

The "Force Local Backup" button calls `downloadReportBackup()` → `getReportSnapshot()` which reads from `localStorage`. However, snapshots are only written to localStorage during:

1. **`performSave()`** — triggered by auto-save (1.5s debounce after a change) or manual "Save Progress" click
2. **`onEmergencySnapshot`** — triggered on `visibilitychange`/`pagehide`

If the user opens a form and clicks "Force Local Backup" **before any save has fired** (or on a report with no unsaved changes that was loaded from the server/IndexedDB), no localStorage snapshot exists yet, so `getReportSnapshot()` returns `null` and the warning toast fires.

This affects all three form types (Inspection, Training, Daily Assessment).

### Fix

Make `downloadReportBackup` **create the snapshot on demand** when none exists. In each form's `onClick` handler for the Force Local Backup button, write a snapshot immediately before calling `downloadReportBackup`, using the current React state. This ensures a snapshot is always available.

### Changes

**`src/pages/InspectionForm.tsx`** — In the HardDrive button `onClick` (around line 2498):
- Before calling `downloadReportBackup`, call `saveReportSnapshot('inspection', id, inspection, { systems, ziplines, equipment, standards, summary: [summary] }, !!inspection?.synced_at)` to ensure a snapshot exists.

**`src/pages/TrainingForm.tsx`** — Same pattern: write snapshot from current state before `downloadReportBackup`.

**`src/pages/DailyAssessmentForm.tsx`** — Same pattern.

This is a 3-line addition per form (snapshot write + existing download call), no new files or dependencies.

