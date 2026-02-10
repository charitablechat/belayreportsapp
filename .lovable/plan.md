

# Fix Back Navigation Using React Router's `useBlocker`

## Root Cause

The custom `useUnsavedChanges` hook only handles two things:
1. `beforeunload` event -- prevents tab close/refresh (works)
2. `safeNavigate` wrapper -- intercepts programmatic navigation (works for the app back button)

But it does NOT intercept the **browser's back/forward buttons**. When the user presses the browser back button, React Router handles the `popstate` event directly and navigates away without any check. The `beforeunload` event does not fire for in-SPA route changes.

React Router v7 provides `useBlocker` specifically for this purpose -- it intercepts all SPA navigation including browser back/forward buttons.

## Solution

Rewrite `useUnsavedChanges` to use React Router's built-in `useBlocker` hook instead of the manual approach.

### File: `src/hooks/useUnsavedChanges.tsx`

Replace the current implementation with one that uses `useBlocker`:

```typescript
import { useEffect, useCallback } from "react";
import { useBlocker } from "react-router-dom";

export function useUnsavedChanges({ hasUnsavedChanges, message }) {
  // Block SPA navigation (covers browser back, forward, and link clicks)
  const blocker = useBlocker(hasUnsavedChanges);

  // Block hard page unload (refresh, tab close)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = message;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges, message]);

  // safeNavigate no longer needed -- useBlocker intercepts ALL navigation
  const safeNavigate = useCallback((to) => {
    // Navigate normally; useBlocker will intercept if needed
    navigate(to);
  }, [navigate]);

  return {
    isBlocked: blocker.state === "blocked",
    confirmNavigation: () => blocker.proceed?.(),
    cancelNavigation: () => blocker.reset?.(),
    safeNavigate,
    message,
  };
}
```

Key changes:
- `useBlocker(hasUnsavedChanges)` automatically intercepts ALL SPA navigation (browser back, forward, link clicks, programmatic `navigate()` calls)
- `blocker.state === "blocked"` replaces the manual `pendingNavigation` state
- `blocker.proceed()` lets the navigation continue (replaces `confirmNavigation`)
- `blocker.reset()` cancels the navigation (replaces `cancelNavigation`)
- `safeNavigate` now just calls `navigate()` directly -- `useBlocker` catches it automatically

### File: `src/pages/InspectionForm.tsx`

The `safeGoBack` function simplifies because `useBlocker` intercepts all navigation:

```typescript
const safeGoBack = useCallback(() => {
  if (window.history.length > 1) {
    navigate(-1);
  } else {
    navigate("/dashboard");
  }
}, [navigate]);
```

This is now just the normal `goBack` logic -- no need to route through `safeNavigate` because `useBlocker` will automatically intercept the navigation and show the dialog if there are unsaved changes.

### No changes to other files

- `UnsavedChangesDialog` -- stays the same, still receives `isOpen`, `onConfirm`, `onCancel`
- `TrainingForm.tsx` and `DailyAssessmentForm.tsx` -- they use the same `useUnsavedChanges` hook, so they automatically get the fix too
- `goBack` utility in `src/lib/navigation.ts` -- can remain as-is

## What Changes in Behavior

- **Browser back button**: Now properly blocked when there are unsaved changes. The "Unsaved Changes" dialog appears.
- **App back arrow**: Works the same as before (dialog when dirty, navigates when clean).
- **Swipe-to-go-back**: Works the same as before.
- **Browser refresh / tab close**: Still shows the browser's native "Leave site?" prompt (unchanged).

