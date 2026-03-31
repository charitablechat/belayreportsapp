

## Fix Device Back Button Navigation

### Root Cause

There are two bugs causing the back button to malfunction:

1. **`navigationDepth` gets out of sync with reality.** It increments on every forward navigation but only decrements when `goBack()` is called from in-app buttons. When the user presses the **device back button**, the browser navigates back via `popstate`, but `navigationDepth` is never decremented. After a few hardware back presses, the depth counter is wrong, causing `goBack()` to misjudge whether there's history.

2. **The sentinel `pushState` on mount adds a phantom history entry.** When the app mounts, it pushes `{ lovableGuard: true }` into the history stack. This means the user's first device back press navigates to the sentinel entry instead of the previous page, creating a "dead" back press that does nothing visible (or redirects to dashboard unexpectedly).

### Solution

**1. `src/App.tsx` — Fix the history guard to also track depth on hardware back**

Consolidate the popstate handling into a single listener that:
- Decrements `navigationDepth` on every hardware back press (when depth > 0 and it's not the sentinel)
- Only traps exit attempts when the sentinel is actually hit and depth is 0
- Re-pushes the sentinel after trapping to maintain the guard

**2. `src/lib/navigation.ts` — Add a `decrementNavigation()` export**

Add a function to decrement the depth counter, so the popstate handler in `App.tsx` can keep it in sync when the device back button is used (bypassing `goBack()`).

### Technical Detail

```text
Before (broken):
  Forward nav: depth++ ✓
  In-app back button (goBack): depth-- ✓
  Device back button (popstate): depth unchanged ✗ ← BUG

After (fixed):
  Forward nav: depth++ ✓
  In-app back button (goBack): depth-- ✓
  Device back button (popstate): depth-- ✓  ← FIXED
```

The updated popstate handler logic:
```
on popstate:
  if event.state has lovableGuard AND depth === 0:
    → re-push sentinel, navigate to /dashboard (exit guard)
  else if depth > 0:
    → decrement depth (keep counter in sync with browser history)
```

### Files Changed
- `src/lib/navigation.ts` — Add `decrementNavigation()` export
- `src/App.tsx` — Merge popstate listeners, add depth decrement on hardware back

