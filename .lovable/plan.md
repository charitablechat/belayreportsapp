

## Prevent Device Back Button from Exiting the App

**Problem**: When a user presses the device/browser back button and there's no more browser history (e.g., they opened the app directly), the app exits instead of staying in the app.

**Solution**: Push a sentinel history entry on app mount so the browser always has something to "go back" to. When that sentinel is hit (popstate), redirect to `/dashboard` instead of exiting.

### Changes

**1. `src/App.tsx` — Add history exit guard in `RootLayout`**

Add a `useEffect` that:
- Pushes a sentinel state entry (`{ lovableGuard: true }`) into `window.history` on mount
- Listens for `popstate` — if the event state has the sentinel flag and `navigationDepth` is 0, it means the user has exhausted in-app history, so we push the sentinel again and navigate to `/dashboard`

This ensures the device back button never exits the app — it either goes back one step (handled by React Router) or lands on the dashboard.

**2. `src/lib/navigation.ts` — Export `getNavigationDepth()`**

Add a getter so `App.tsx` can read the current depth without importing the mutable variable directly.

### Technical detail

```text
User flow:
  [App opens] → pushState(sentinel)
  [User navigates] → /dashboard → /inspection/123 → /inspection/123/photos
  [Back button x1] → /inspection/123  (normal browser back, depth > 0)
  [Back button x2] → /dashboard       (normal browser back, depth > 0)
  [Back button x3] → hits sentinel → re-push sentinel, navigate(/dashboard)
                      (user stays in app)
```

No changes needed to any of the 11 files using `goBack()` — they already work correctly with the depth-based logic.

