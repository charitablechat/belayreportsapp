

# Fix Double-Dialog Flash When Exiting Reports

## Root Cause

The bug is caused by the interaction between two systems:

1. **`useReportTabHistory`** pushes extra browser history entries (one per tab visited) using `window.history.pushState({ reportTab: ... })`.
2. **`useBlocker`** (inside `useUnsavedChanges`) intercepts SPA navigation and shows the `UnsavedChangesDialog`.

When the user presses the browser/hardware back button:
- React Router's `useBlocker` intercepts the navigation and shows the `UnsavedChangesDialog`
- The user clicks "Save & Exit" or "Exit — Nothing to Save"
- `confirmNavigation()` calls `blocker.proceed()`, which continues the **original back navigation**
- But the previous history entry is a **tab history entry** (`{ reportTab: "..." }`), NOT the dashboard
- So the user lands on another history entry **still on the same form page**
- `bypassRef` gets reset by the cleanup effect
- The `popstate` listener in `useReportTabHistory` fires and either changes tabs or calls `onFirstTabBack()`, which shows the `SaveBeforeLeaveDialog` — causing the dialog to flash again

## Fix

Change `confirmNavigation` and `saveAndLeave` in `useUnsavedChanges` to **reset the blocker and navigate explicitly to a fallback path** instead of calling `blocker.proceed()` (which tries to continue the original back-navigation through stale tab history entries).

### Changes

**`src/hooks/useUnsavedChanges.tsx`**:
- Add a `fallbackPath` option (default: `'/dashboard'`)
- `confirmNavigation`: call `blocker.reset()` + `navigate(fallbackPath)` instead of `blocker.proceed()`
- `saveAndLeave`: same — after saving, `blocker.reset()` + `navigate(fallbackPath)` instead of `blocker.proceed()`
- Keep `bypassAndProceed` unchanged (it's used by `SaveBeforeLeaveDialog` which already calls `navigate('/dashboard')` explicitly after)

```text
Before:  confirmNavigation → bypassRef=true → blocker.proceed()
                              ↓
                    Goes to tab history entry (wrong!)
                              ↓
                    Still on form → dialog fires again

After:   confirmNavigation → bypassRef=true → blocker.reset() → navigate('/dashboard')
                              ↓
                    Goes directly to dashboard ✓
```

No changes needed in the three form components — they all already use `alwaysBlock: true` and want to navigate to `/dashboard` on exit.

## Files
- `src/hooks/useUnsavedChanges.tsx` — add `fallbackPath` option, update `confirmNavigation` and `saveAndLeave`

