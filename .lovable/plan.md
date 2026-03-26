

## Fix: Brief Red Warning Flash on Save

### Root Cause

In `src/pages/InspectionForm.tsx`, the `performSave` function runs validation at line 1356. When any validation warning exists (e.g., an empty field), it immediately calls `setSaveError(errorMsg)` at line 1374, which causes the `AutoSaveIndicator` to render in red (`text-destructive`) with an error icon. The save then **continues anyway** (it's a non-blocking warning), and a few milliseconds later at line 1505, `setSaveError(null)` clears the error. This causes the brief red flash.

The sequence is:
```text
setSaveError("Validation warning: ...")  →  red flash appears
  ... save completes (few ms) ...
setSaveError(null)                       →  red flash disappears
```

### Fix

**Stop setting `saveError` for validation warnings that don't block the save.** The error state should only be set for actual failures (offline storage errors, auth failures). Validation warnings during a successful save should be logged but not surfaced through the error indicator.

### Changes

**File: `src/pages/InspectionForm.tsx`**

1. **Remove `setSaveError(errorMsg)` from the validation warning block** (line 1374). The save continues regardless, so this isn't a real error — it's informational.
2. Keep the `console.warn` logging so validation issues are still visible in dev tools.
3. The existing `setSaveError` calls for actual failures (line 1490 for offline storage failure, line 1913 for auto-save failure) remain unchanged.

This is a single-line removal that eliminates the red flash while preserving all error handling for real failures.

