

# Fix: Admin Panel Snapshot Loading Spinner Hang

## Root Cause

The spinner hangs because snapshot-loading functions (`fetchCloudSnapshots`, `fetchAllCloudSnapshots`, `fetchAdminEditSnapshots`) resolve user profile names via `getCachedProfile` — which makes individual database queries **with no timeout**. If any query hangs (slow network, connection issues), the entire `Promise.all` never resolves, and `setLoading(false)` in the `finally` block is never reached.

**Not involved:** `PhotoCapture.tsx` and `sync-manager.ts` are unrelated to admin panel snapshot loading. The issue is entirely within the profile resolution step of the cloud-backup and admin-edit-snapshot modules.

## Proposed Fix (2 files)

### 1. `src/lib/profile-cache.ts` — Add a per-query timeout

Wrap the Supabase `.select()` call in a `Promise.race` with a 5-second timeout. If the query doesn't resolve in time, return `null` (the caller already handles missing profiles gracefully by showing "Unknown").

```
Before:  const { data } = await supabase.from('profiles').select(...)
After:   const { data } = await Promise.race([
           supabase.from('profiles').select(...),
           new Promise(resolve => setTimeout(() => resolve({ data: null }), 5000))
         ])
```

This single change fixes all three panels since they all funnel through `getCachedProfile`.

### 2. `src/components/admin/DataRecoveryTool.tsx` — Add a 15-second safety timeout to each panel's load function

Wrap the `loadSnapshots` async call body in a `Promise.race` with a 15-second overall timeout. If hit, set `loading = false`, show a toast error, and render an empty state instead of an infinite spinner.

Affects: `CloudSnapshotsPanel.loadSnapshots`, `AllUserSnapshotsPanel.loadSnapshots`, `AdminEditHistoryPanel.loadSnapshots`.

## Result
- Profile queries that hang will timeout after 5s, showing "Unknown" for that user's name
- Panel loading that hangs for any reason will timeout after 15s, clearing the spinner and showing an error toast
- No changes to PhotoCapture or sync-manager (not related)

