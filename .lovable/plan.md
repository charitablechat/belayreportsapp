

## Fix: Navigation Loop Between Two Competing Exit Dialogs

### Root Cause

There are **two independent navigation guard systems** that fight each other:

1. **`SaveBeforeLeaveDialog`** -- shown when the user taps the in-app back button (`setShowLeaveDialog(true)`)
2. **`useBlocker` / `UnsavedChangesDialog`** -- React Router's built-in navigation blocker

When the user confirms exit via `SaveBeforeLeaveDialog`, the handler does:
```
setHasUnsavedChanges(false);   // schedules React re-render
setTimeout(() => goBack(navigate), 0);  // schedules navigation
```

The **race condition**: `setTimeout(0)` fires a macrotask. React's state flush may or may not complete before it runs. If `goBack(navigate)` fires before React re-renders, `useBlocker` still holds the **old** value (`true`) from the previous render. It intercepts the navigation, and one of two things happens:

- **Scenario A (Stuck):** React then re-renders with `useBlocker(false)`, which auto-resets the blocker. The blocked navigation is **silently dropped** -- no dialog, no navigation. The user is stranded on the form with no visible UI to interact with.
- **Scenario B (Double dialog):** `UnsavedChangesDialog` appears on top. The user must click through a second dialog, which is confusing but eventually works.

The `leavingRef` was intended to prevent this, but it's a **ref** (not state) -- it doesn't trigger a re-render. The expression `hasUnsavedChanges && !leavingRef.current` was already evaluated and baked into `useBlocker` during the previous render cycle. The ref change has no effect until the next render.

### Fix

Replace `setTimeout(() => goBack(navigate), 0)` with **synchronous state flushing** using React DOM's `flushSync`. This forces React to process `setHasUnsavedChanges(false)` immediately, so `useBlocker` receives `false` **before** navigation fires.

### Code Changes

#### 1. All 3 Form Files (identical pattern)

**`src/pages/InspectionForm.tsx`**, **`src/pages/TrainingForm.tsx`**, **`src/pages/DailyAssessmentForm.tsx`**

Add import:
```typescript
import { flushSync } from "react-dom";
```

Replace the `onSave` handler:
```typescript
onSave={async () => {
  if (isSavingBeforeLeave) return;
  setIsSavingBeforeLeave(true);
  leavingRef.current = true;
  try {
    await Promise.race([
      handleSaveAndLeave(),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]);
    emitSyncComplete();
    markPendingDashboardRefresh();
    // flushSync forces useBlocker to re-evaluate BEFORE we navigate
    flushSync(() => {
      setShowLeaveDialog(false);
      setHasUnsavedChanges(false);
    });
    goBack(navigate);
  } catch (e) {
    console.warn('[Form] Save-before-leave error:', e);
    flushSync(() => {
      setShowLeaveDialog(false);
      setHasUnsavedChanges(false);
    });
    goBack(navigate);
  } finally {
    setIsSavingBeforeLeave(false);
  }
}}
```

Replace the `onLeave` handler:
```typescript
onLeave={() => {
  leavingRef.current = true;
  flushSync(() => {
    setShowLeaveDialog(false);
    setHasUnsavedChanges(false);
  });
  goBack(navigate);
}}
```

### Why `flushSync` Fixes This

- `flushSync` forces React to synchronously flush state updates and re-render before returning
- After `flushSync` returns, `useBlocker` has already received `false`
- `goBack(navigate)` then fires immediately with no blocker to intercept it
- No `setTimeout(0)` needed -- the race condition is eliminated entirely
- `leavingRef` remains as a secondary safety net but is no longer load-bearing

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/InspectionForm.tsx` | Add `flushSync` import; replace `setTimeout` with `flushSync` in `onSave` and `onLeave` |
| `src/pages/TrainingForm.tsx` | Same |
| `src/pages/DailyAssessmentForm.tsx` | Same |

### What This Does NOT Change

- No changes to `useUnsavedChanges` hook or `useBlocker` logic
- No changes to `SaveBeforeLeaveDialog` or `UnsavedChangesDialog` components
- No changes to save logic (`performSave`, `handleSaveAndLeave`)
- No changes to IndexedDB, sync, or data persistence layers

