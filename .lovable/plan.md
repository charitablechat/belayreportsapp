

# Fix Sign-Out Data Flush and Force Refresh Safety

## Issue 1: Sign-out doesn't flush unsynced data

The global `AuthenticatedHeader` calls `supabase.auth.signOut()` directly without first syncing any pending IndexedDB operations. If a user has unsynced reports and signs out, those records become orphaned if a different user logs in on the same device.

### Fix
Before calling `signOut()`, trigger a force sync attempt via the PWA context's `forceSync()` method. This reuses the existing `useAutoSync.performSync(false)` pipeline which processes all three operation types (inspections, trainings, assessments).

**Changes to `src/components/AuthenticatedHeader.tsx`:**
- Import and use `usePWA()` to access `forceSync` and `unsyncedCount`
- In `handleSignOut`: if online and `unsyncedCount > 0`, await `forceSync()` (with a safety timeout of ~8 seconds) before calling `signOut()`
- If offline or sync fails, proceed with sign-out anyway (data stays safely in IndexedDB for the same user's next login)
- Show a brief toast: "Syncing data before sign-out..." when flushing

## Issue 2: Force Refresh destroys offline PWA shell

`handleForceRefresh` in `ManualUpdateButton.tsx` deletes ALL Cache Storage entries and unregisters service workers. This means if the user goes offline afterward, the app won't load at all since the precached shell is gone.

### Fix
Add a confirmation warning that explicitly tells the user this will make the app unavailable offline until they reconnect.

**Changes to `src/components/pwa/ManualUpdateButton.tsx`:**
- Replace the immediate `handleForceRefresh` call with an `AlertDialog` confirmation
- The dialog text warns: "This will clear all cached data and make the app unavailable offline until you reconnect to the internet. Your report data will be preserved."
- Only proceed if confirmed

## Files Modified

| File | Change |
|------|--------|
| `src/components/AuthenticatedHeader.tsx` | Add `usePWA()`, flush sync before sign-out with timeout |
| `src/components/pwa/ManualUpdateButton.tsx` | Add AlertDialog confirmation for Force Refresh with offline warning |

## Technical Details

### AuthenticatedHeader sync-before-signout
```
handleSignOut:
  1. setSigningOut(true)
  2. if (navigator.onLine && unsyncedCount > 0):
       show toast "Syncing data..."
       await Promise.race([forceSync(), timeout(8000)])
  3. await supabase.auth.signOut()
  4. catch: setSigningOut(false)
```

The 8-second timeout prevents the sign-out from hanging indefinitely if sync stalls. This matches the existing non-blocking save timeout pattern used across the app.

### Force Refresh AlertDialog
The dropdown menu item for "Force Refresh (Clear Cache)" will open a confirmation dialog instead of executing immediately. The dialog uses the existing `AlertDialog` component from the UI library (already imported elsewhere in the app). State is managed with a simple `useState<boolean>` for dialog visibility.

