

# Fix: Stale Closure in Save-Before-Leave Causes Equipment Data Loss

## Root Cause

All three report forms (InspectionForm, TrainingForm, DailyAssessmentForm) share an identical stale closure bug in the "Save and Leave" handler.

The `handleSaveAndLeave` function is wrapped in `useCallback(..., [])` with an **empty dependency array**. This means it captures the save function (`performSave` / `saveTraining` / `handleSaveProgress`) from the **first render only**. That first-render save function closes over the initial empty state arrays (`equipment = []`, `systems = []`, etc.).

When a user edits equipment fields and navigates away, the "Unsaved Changes" dialog fires correctly (thanks to the previous fix), but clicking **"Save and Leave"** calls the stale save function which reads the initial empty state -- effectively overwriting real data with empty arrays.

**Why the existing ref pattern doesn't help:**
```typescript
const handleSaveAndLeave = useCallback(async () => {
  await performSave(true);  // <-- captures first-render performSave
}, []);  // <-- never recreated

saveBeforeLeaveRef.current = handleSaveAndLeave;  // Same stale function every render
```

The ref updates every render, but to the **same stale function** since `useCallback(fn, [])` never recreates it.

## Fix

Use a ref for the save function itself, so the stable `handleSaveAndLeave` always calls the **latest** version:

### InspectionForm.tsx

Add a `performSaveRef` that updates every render. Then `handleSaveAndLeave` calls through the ref instead of capturing `performSave` directly.

**Before (line 168-183):**
```typescript
const handleSaveAndLeave = useCallback(async () => {
  if (saveDebounceTimerRef.current) {
    clearTimeout(saveDebounceTimerRef.current);
    saveDebounceTimerRef.current = null;
  }
  try {
    await performSave(true);  // STALE -- first-render closure
    setHasUnsavedChanges(false);
  } catch (e) { ... }
}, []);
saveBeforeLeaveRef.current = handleSaveAndLeave;
```

**After:**
```typescript
const performSaveRef = useRef<(silent: boolean) => Promise<void>>();
// (performSaveRef.current = performSave is set after performSave is defined)

const handleSaveAndLeave = useCallback(async () => {
  if (saveDebounceTimerRef.current) {
    clearTimeout(saveDebounceTimerRef.current);
    saveDebounceTimerRef.current = null;
  }
  try {
    await performSaveRef.current?.(true);  // Always latest via ref
    setHasUnsavedChanges(false);
  } catch (e) { ... }
}, []);
saveBeforeLeaveRef.current = handleSaveAndLeave;
```

Then after `performSave` is defined (~line 1429):
```typescript
performSaveRef.current = performSave;
```

### TrainingForm.tsx

Same pattern -- add `saveTrainingRef`:

**Before (line 131):**
```typescript
await saveTraining();  // STALE
```

**After:**
```typescript
const saveTrainingRef = useRef<() => Promise<void>>();
// ...
await saveTrainingRef.current?.();  // Always latest
// After saveTraining is defined (~line 556):
saveTrainingRef.current = saveTraining;
```

### DailyAssessmentForm.tsx

Same pattern -- add `handleSaveProgressRef`:

**Before (line 132):**
```typescript
await handleSaveProgress();  // STALE
```

**After:**
```typescript
const handleSaveProgressRef = useRef<() => Promise<void>>();
// ...
await handleSaveProgressRef.current?.();  // Always latest
// After handleSaveProgress is defined:
handleSaveProgressRef.current = handleSaveProgress;
```

## Files Changed

1. **src/pages/InspectionForm.tsx** -- Add `performSaveRef`, update `handleSaveAndLeave` to use it, set ref after `performSave` definition
2. **src/pages/TrainingForm.tsx** -- Add `saveTrainingRef`, update `handleSaveAndLeave` to use it, set ref after `saveTraining` definition
3. **src/pages/DailyAssessmentForm.tsx** -- Add `handleSaveProgressRef`, update `handleSaveAndLeave` to use it, set ref after `handleSaveProgress` definition

## Why This Is Safe

- The ref pattern is already proven in the codebase (e.g., `triggerImmediateSaveRef` on line 1431 of InspectionForm uses the exact same approach)
- No changes to data loading, IndexedDB persistence, sync logic, or database operations
- The `useCallback(..., [])` wrapper is preserved for stability -- only the internal call target changes from a direct capture to a ref lookup
- All existing auto-save, debounce, and manual save paths are unaffected

## Impact

| Scenario | Before | After |
|----------|--------|-------|
| Edit equipment, click "Save and Leave" | Saves empty initial state, data lost | Saves current state with all edits |
| Edit training fields, click "Save and Leave" | Saves stale first-render state | Saves current state |
| Edit assessment, click "Save and Leave" | Saves stale first-render state | Saves current state |
| Auto-save (1.5s debounce) | Already works (not affected) | No change |
| Manual save button | Already works (not affected) | No change |

