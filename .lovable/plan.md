

# Fix: Equipment Input Blocked by Concurrent Save Race Condition

## Root Cause

The issue is NOT the `isInternalUpdateRef` timing (that fix was correct but addressed a secondary problem). The primary issue is a **concurrent save race condition** caused by the safety timeout:

```text
1. User changes qty --> auto-save watcher fires (1.5s debounce)
2. autoSaveProgress() starts, sets autoSaving=true
3. performSave() runs: offline save completes fast (~0s),
   but syncWithRetry(3) to the server is slow (network latency)
4. 8-second safety timeout fires --> sets autoSaving=false
   (but the sync is STILL running in the background!)
5. 10-second backup interval sees: hasUnsavedChanges=true, autoSaving=false
   --> starts ANOTHER autoSaveProgress()
6. Now TWO concurrent performSave() calls are running
7. Constant state toggling (setAutoSaving true/false) causes
   continuous re-renders across all 8 EquipmentTable components
8. Input fields become unresponsive due to render thrashing
```

The `triggerImmediateSave` change (removing the `autoSaving` guard) made this worse -- it can now start a THIRD concurrent save on every field blur.

## Fix (1 file, 3 targeted changes)

**File: `src/pages/InspectionForm.tsx`**

### Change 1: Add a unified ref-based concurrency lock

A single `anySaveInProgressRef` prevents ALL save entry points from running concurrently. Unlike state-based guards, this ref is NOT reset by the safety timeout, so the actual save completes without interference.

```typescript
// Near line 89, alongside other refs
const anySaveInProgressRef = useRef(false);
```

### Change 2: Guard `autoSaveProgress` with the ref

```typescript
const autoSaveProgress = async () => {
  if (!hasUnsavedChanges || saving || autoSaving || anySaveInProgressRef.current) return;

  anySaveInProgressRef.current = true;
  setAutoSaving(true);

  const safetyTimeout = setTimeout(() => {
    console.warn('[InspectionForm] autoSaveProgress safety timeout reached, forcing state reset');
    setAutoSaving(false);
    // NOTE: anySaveInProgressRef is NOT reset here -- the actual save
    // still running will reset it in `finally`
  }, 8000);

  try {
    await performSave(true);
    setLastSaved(new Date());
    setHasUnsavedChanges(false);
  } catch (error: any) {
    console.error("Auto-save failed:", error);
    setSaveError(error.message || 'Auto-save failed');
  } finally {
    clearTimeout(safetyTimeout);
    setAutoSaving(false);
    anySaveInProgressRef.current = false;
  }
};
```

### Change 3: Guard `triggerImmediateSave` with the ref, queue instead of drop

Instead of running concurrently or silently dropping, mark `hasUnsavedChanges = true` so the next save cycle picks up the data.

```typescript
const triggerImmediateSave = async () => {
  if (saving || anySaveInProgressRef.current) {
    // Don't drop the save -- ensure data is saved on the next cycle
    setHasUnsavedChanges(true);
    return;
  }

  // ... rest unchanged
  anySaveInProgressRef.current = true;

  // ... existing logic ...

  // In finally block, add:
  anySaveInProgressRef.current = false;
};
```

## Why This Fixes the Problem

- **No concurrent saves**: The ref-based lock prevents a new save from starting while a previous one is still running, regardless of the safety timeout
- **Safety timeout still protects UI**: It resets `autoSaving` state so the UI indicator recovers, but the ref lock prevents a new save from starting
- **No dropped data**: When `triggerImmediateSave` is blocked, it sets `hasUnsavedChanges = true`, guaranteeing the quantity change is picked up by the next save
- **No render thrashing**: Without concurrent saves toggling state back and forth, re-renders are minimal and input fields remain responsive

## What This Does NOT Change

- No changes to EquipmentTable.tsx
- No changes to tab styling
- No database or API changes
- No new dependencies
- The `isInternalUpdateRef` logic from the previous fix remains intact

## Verification Strategy

After applying the fix:
1. Open an existing inspection with equipment items
2. Navigate to the Equipment tab
3. Click into a Quantity field in Belay, Trolleys, or Other Equipment
4. Type a number -- it should appear immediately with no lag
5. Click out (blur) -- "Changes saved" toast should appear once
6. Reload the page -- the quantity should be persisted
7. Rapid test: change qty in 3 different categories within 5 seconds -- all values should persist after reload

