

# Fix Persistent "Unsaved Changes" Indicator on Form Load

## Problem

When opening an inspection report, the yellow "Unsaved changes" indicator appears immediately, even though the user hasn't edited anything. This happens because:

1. Auto-populate effects (ACCT number, summary fields) modify form state on load
2. The auto-save watcher sees these changes and sets `hasUnsavedChanges = true`
3. `lastSaved` starts as `null`, so even after auto-save completes, the indicator may flash

## Solution

Two targeted fixes in `src/pages/InspectionForm.tsx`:

### Fix 1: Mark auto-populate effects as internal updates

Wrap the ACCT number and summary auto-populate logic with the `isInternalUpdateRef` flag so they don't trigger the unsaved changes detector.

- **ACCT# auto-populate** (~line 372): Set `isInternalUpdateRef.current = true` before calling `handleHeaderUpdate`
- **Summary auto-populate** (~line 418): Set `isInternalUpdateRef.current = true` before modifying summary state

### Fix 2: Initialize `lastSaved` when data loads from server

After successfully loading inspection data (from server or IndexedDB), set `lastSaved` to `new Date()` so the indicator starts in the green "Saved" state rather than showing nothing or "Unsaved".

## Technical Details

**File:** `src/pages/InspectionForm.tsx`

**Change 1 - ACCT auto-populate (~line 371-375):**
```typescript
useEffect(() => {
  if (inspection && inspectorProfile && !inspection.acct_number && inspectorProfile.acct_number) {
    isInternalUpdateRef.current = true;
    handleHeaderUpdate('acct_number', inspectorProfile.acct_number);
  }
}, [inspectorProfile, inspection?.id]);
```

**Change 2 - Summary auto-populate (~line 418+):**
Add `isInternalUpdateRef.current = true` before modifying summary state in the auto-populate effect.

**Change 3 - Initialize lastSaved on load:**
In the data loading/reconciliation logic, after inspection data is successfully loaded, add:
```typescript
setLastSaved(new Date());
```

This ensures the indicator shows green "Saved" immediately on load, yellow "Unsaved changes" only when the user actually edits something, and green "Saved" again after auto-save completes.

