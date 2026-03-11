

## Investigation: Unsaved Changes Warning Modal Failure

### Architecture Overview

There are **two separate exit-warning systems** operating in parallel:

| Trigger | Dialog | State Key |
|---------|--------|-----------|
| User clicks form's ← back button | `SaveBeforeLeaveDialog` | `showLeaveDialog` |
| Any SPA navigation (browser back, header links, programmatic) | `UnsavedChangesDialog` | `isBlocked` (from `useBlocker`) |
| Hard page unload (refresh, tab close) | Browser native prompt | `beforeunload` event |

---

### Top 3 Root Causes (Prioritized)

#### 1. `beforeunload` Does NOT Fire on Mobile Browsers (High Likelihood)

The `beforeunload` handler in `useUnsavedChanges` (line 24-35) only fires when `hasUnsavedChanges` is true. But critically:

- **iOS Safari ignores `beforeunload` entirely** — Apple's WebKit does not show the browser prompt on tab close, app switch, or page refresh
- **Android Chrome** fires it inconsistently in PWA mode
- After auto-save completes (1.5s debounce), `hasUnsavedChanges` is set to `false`, so even on desktop the native prompt won't fire

The `useEmergencySave` hook covers data persistence via `visibilitychange`/`pagehide`, but **no visual warning** is shown to the user in these cases — the data is silently saved.

**Validation:** Close a tab on iOS Safari immediately after typing — no warning will appear regardless of dirty state.

#### 2. `alwaysBlock` + `SaveBeforeLeaveDialog` Creates a Double-Block Race (Medium Likelihood)

Current flow when user clicks the form's back arrow:
1. `setShowLeaveDialog(true)` → opens `SaveBeforeLeaveDialog`
2. User clicks "Exit — Nothing to Save" → handler runs:
   ```ts
   setIsLeaving(true);
   flushSync(() => { setShowLeaveDialog(false); setHasUnsavedChanges(false); });
   navigate('/dashboard');
   ```
3. `navigate('/dashboard')` triggers `useBlocker` evaluation
4. `useBlocker` condition: `!isLeaving || hasUnsavedChanges` — after `flushSync`, this should be `false`

**The race:** `flushSync` forces a synchronous re-render, but React Router's `useBlocker` reads its blocking predicate from the **previous committed value** at the time the navigation is initiated. If `useBlocker` evaluates before the `flushSync` commit propagates to the router, `alwaysBlock` is still `true` and the `UnsavedChangesDialog` opens ON TOP of the closing `SaveBeforeLeaveDialog`.

**Result:** User sees `UnsavedChangesDialog` unexpectedly (or sees nothing if the two dialogs cancel each other out via competing `onOpenChange` handlers).

**Validation:** Add `console.log('blocker evaluated, alwaysBlock:', !isLeaving)` inside `useUnsavedChanges` and check if it logs `true` after `flushSync` sets `isLeaving`.

#### 3. Auto-Save Clears `hasUnsavedChanges` → `beforeunload` Becomes a No-Op (Medium Likelihood)

All three forms clear `hasUnsavedChanges` after auto-save:
- `InspectionForm.tsx` line 1875: `setHasUnsavedChanges(false)` after auto-save
- `TrainingForm.tsx` line 891: same
- `DailyAssessmentForm.tsx` line 950: same

The `alwaysBlock` flag ensures `useBlocker` still fires for SPA navigation. But `beforeunload` (line 26) checks `hasUnsavedChanges` directly — **not** `alwaysBlock`. So after auto-save completes:
- SPA navigation: dialog shows (via `alwaysBlock`) ✓
- Tab close/refresh: **no warning** ✗

This is by design for the `alwaysBlock` feature (the data IS saved), but users may perceive it as "the warning didn't show."

---

### Proposed Fix

**Single consolidated change:** Make the `beforeunload` handler respect `alwaysBlock` too, and eliminate the `flushSync` race by using a ref-based bypass in the blocker instead of relying on synchronous state propagation.

**File: `src/hooks/useUnsavedChanges.tsx`**
- Change `beforeunload` condition from `if (hasUnsavedChanges)` to `if (alwaysBlock || hasUnsavedChanges)` so tab close always warns while inside a form
- Use a `leavingRef` internally: set it to `true` before calling `blocker.proceed()`, and check it in the blocker predicate — this avoids the `flushSync` race entirely

**Files: `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`**
- Remove the `isLeaving` state and `flushSync` pattern from exit handlers
- Instead, call `confirmNavigation()` or `saveAndLeave()` from the `SaveBeforeLeaveDialog` handlers — these already call `blocker.proceed()` which bypasses the guard cleanly
- This eliminates the dual-dialog race entirely by routing ALL exits through `useBlocker`'s proceed/reset API

**Net effect:** One consistent exit path via `useBlocker`, no `flushSync` timing dependency, `beforeunload` always fires while form is mounted.

