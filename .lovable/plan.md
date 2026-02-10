
# Fix: "Temple of Doom" Not Syncing and Redirecting to Dashboard

## What's Happening

Two related problems stem from the same root cause: the inspection was created offline with a temporary ID (`temp-XXXX`), and the sync pipeline is failing silently on mobile.

### Problem 1: Redirect to Dashboard
When you try to open the report on mobile (while online), the InspectionForm:
1. Loads the record from IndexedDB successfully (temp-ID lookup works)
2. Attempts to update `last_opened_at` in the database using the temp-ID (silently fails, no rows matched)
3. Queries the database for the inspection using the temp-ID -- returns `null`
4. Reaches the check: `if (!data && !offlineData)` -- but `offlineData` should exist...

The likely cause is that IndexedDB's 3-second timeout (`withOfflineTimeout`) is too tight on mobile under load, causing `offlineData` to return `null`. Combined with the server also returning `null` (temp-ID doesn't exist), both are null, triggering the redirect at line 867.

### Problem 2: Sync Not Completing
The sync system detects the unsynced record and starts the temp-ID-to-UUID transformation, but the transaction is failing due to one of:
- Session validation timeout (5s limit at line 487 in `atomic-sync-manager.ts`)
- The step timeout (now 15s, but was 8s) still not enough for this specific record
- Silent catch swallowing the error without surfacing it to the UI

## Solution

### Change 1: Prevent redirect when offline data exists but server data doesn't (InspectionForm)

The form should not redirect to dashboard when a temp-ID inspection exists in IndexedDB. The current logic correctly checks `!data && !offlineData`, but the offline load can time out on mobile (3s limit). Increase the offline timeout for the initial inspection header load from 3s to 5s, and add a fallback retry without timeout if the first attempt returns null but we know the ID is a temp-ID.

**File: `src/pages/InspectionForm.tsx`** (around line 720)

```
// Current:
const offlineData = await withOfflineTimeout(
  getOfflineInspection(id!),
  null
);

// New: For temp-ID records, retry without timeout if first attempt fails
let offlineData = await withOfflineTimeout(
  getOfflineInspection(id!),
  null,
  5000  // Increase from 3s to 5s
);

// Temp-ID records only exist locally -- retry without timeout if needed
if (!offlineData && id!.startsWith('temp-')) {
  try {
    offlineData = await getOfflineInspection(id!);
  } catch (e) {
    console.warn('[InspectionForm] Retry for temp-ID also failed:', e);
  }
}
```

### Change 2: Skip server queries for temp-ID inspections (InspectionForm)

When the URL contains a `temp-` ID, there's no point querying the server -- it will never have this record. Skip the server fetch entirely and rely on local data only.

**File: `src/pages/InspectionForm.tsx`** (around line 797)

Wrap the entire server fetch block (`if (isOnline)`) with an additional guard:

```
// Only fetch from server if this isn't a temp-ID (temp records only exist locally)
if (isOnline && !id!.startsWith('temp-')) {
  // ... existing server fetch logic unchanged ...
} else if (!offlineData) {
  // Offline (or temp-ID) and no cached data
  toast({ ... });
  navigate('/dashboard');
  return;
}
```

This eliminates: the `last_opened_at` update failure, the pointless server query, and the false redirect.

### Change 3: Add sync debugging for temp-ID inspections

Add a console log in `syncAllInspectionsAtomic` (in `atomic-sync-manager.ts`) to surface when a temp-ID inspection is found but sync fails, so we can diagnose the mobile sync failure:

**File: `src/lib/atomic-sync-manager.ts`** (around line 534)

After the batch is selected, log temp-ID items specifically:

```
const tempIdItems = batch.filter(i => i.id.startsWith('temp-'));
if (tempIdItems.length > 0) {
  console.log('[Atomic Sync] Batch includes temp-ID inspections:', 
    tempIdItems.map(i => ({ id: i.id.substring(0, 20), org: i.organization }))
  );
}
```

## Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `src/pages/InspectionForm.tsx` | Increase offline timeout from 3s to 5s; retry for temp-IDs | Prevent false null for local-only records |
| `src/pages/InspectionForm.tsx` | Skip server queries when URL has temp-ID | Eliminate pointless server queries and false redirects |
| `src/lib/atomic-sync-manager.ts` | Add temp-ID batch logging | Surface sync failures for diagnosis |

## What This Fixes
- Opening the Temple of Doom report on mobile will load from IndexedDB without being redirected
- No wasted server queries for records that only exist locally
- Better visibility into why temp-ID records aren't syncing

## What This Does NOT Fix (yet)
- The underlying sync failure on mobile needs the console logs to diagnose. Once we can see what's happening (session timeout? transaction failure?), we can apply a targeted fix.
