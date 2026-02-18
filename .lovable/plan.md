
# Fix Sync Pipeline: Eliminate Perpetual Re-Sync Race Condition (v2.5.8)

## Root Cause Identified

The **Druidia inspection** (`2cf180fd`) IS syncing to the server -- but it gets re-flagged as "unsynced" every cycle due to a **timestamp race condition** between the client and a database trigger.

### The Race

1. Sync transaction step 7 runs: `UPDATE inspections SET synced_at = '03:46:47'` (client timestamp)
2. The `update_updated_at_column` **database trigger** fires automatically, setting `updated_at = NOW()` on the server, which becomes `03:46:49` (server clock, ~2s later)
3. The client saves locally with `synced_at = updated_at = '03:46:47'` (the client-generated timestamp)
4. On the next sync cycle, the client reads from IndexedDB: `updated_at (03:46:47) > synced_at (03:46:47)` is false, so that's fine locally
5. **BUT** when the dashboard reloads from the server, it pulls `updated_at = 03:46:49` (the trigger-bumped value) and saves it to IndexedDB
6. Now IndexedDB has `updated_at = 03:46:49` but `synced_at = 03:46:47` -- the record looks "unsynced" again
7. The next sync cycle re-syncs the same unchanged data, the trigger bumps `updated_at` again, and the loop continues forever

This explains why the inspection appears to not persist -- it **does** persist, but it keeps re-syncing infinitely, consuming bandwidth and giving false "pending" counts.

### Secondary Finding: Dashboard Query Timeouts

The console shows 3x `[Dashboard] Network query timed out after 15000 ms` warnings. These are from the `withNetworkTimeout` wrapper racing against the Supabase queries. On slower connections, the dashboard data loading takes >15 seconds, causing fallback to cached data. This is a separate performance issue but not the sync bug.

### Unresolved Sync Conflict

There's also an unresolved sync conflict for `Twin Lakes Family YMCA - Cedar Park` (inspection `f44d0658`) where `local_updated_at` is Feb 13 but `remote_updated_at` is Feb 17. The `useConflicts` hook should auto-resolve this via last-write-wins, but the conflict record persists. This needs investigation but is separate from the main race condition.

---

## Fix Strategy

### Fix 1: Exclude `synced_at`-only updates from the `updated_at` trigger (Database Migration)

Modify the `update_updated_at_column()` function to skip bumping `updated_at` when only `synced_at` changed. This is the cleanest server-side fix.

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip bumping updated_at if ONLY synced_at changed
  -- This prevents the sync pipeline from creating a timestamp drift
  -- that causes records to appear perpetually unsynced
  IF (TG_TABLE_NAME IN ('inspections', 'trainings', 'daily_assessments')) THEN
    -- Check if synced_at is the only column that changed
    IF NEW.synced_at IS DISTINCT FROM OLD.synced_at 
       AND ROW(NEW.*) IS NOT DISTINCT FROM ROW(OLD.* ) THEN
      -- synced_at is handled separately, skip updated_at bump
      RETURN NEW;
    END IF;
  END IF;
  
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
```

**Problem**: The `ROW()` comparison doesn't work cleanly when `synced_at` itself differs. A simpler approach:

### Fix 1 (Revised): Client-side alignment using server timestamp

After the final `synced_at` update step, read back the server's `updated_at` and use THAT as the local `synced_at` and `updated_at`. This ensures perfect alignment.

In `atomic-sync-manager.ts`, after `executeTransaction` succeeds:

```typescript
// After successful transaction, fetch the server's updated_at
// to align local timestamps and prevent re-sync drift
const { data: serverRecord } = await supabase
  .from('inspections')
  .select('updated_at, synced_at')
  .eq('id', inspectionId)
  .single();

const serverTimestamp = serverRecord?.updated_at || new Date().toISOString();

await saveInspectionOffline({
  ...inspection,
  synced_at: serverTimestamp,   // Use server's updated_at as synced_at
  updated_at: serverTimestamp,  // Align to prevent drift
  inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
});
```

This adds 1 small SELECT per synced item but eliminates the infinite re-sync loop.

### Fix 2: Stale Upload Warning (5-minute threshold)

Add a stale upload detector in `useAutoSync.tsx` that warns users when items haven't synced for 5+ minutes while online.

### Fix 3: "Pending Uploads" Chip in Dashboard Header

Add an amber badge next to the SyncPulse showing the count of pending items.

### Fix 4: BUILD_TIMESTAMP Audit Logging

Log `APP_VERSION` and `BUILD_TIMESTAMP` after successful sync for production diagnostics.

### Fix 5: Version Bump to v2.5.8

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/atomic-sync-manager.ts` | Post-sync server timestamp alignment for inspections, trainings, and daily assessments |
| `src/hooks/useAutoSync.tsx` | Stale upload warning (5-min threshold), BUILD_TIMESTAMP logging, sync progress toast |
| `src/pages/Dashboard.tsx` | "Pending Uploads" amber chip in header |
| `vite.config.ts` | Bump to v2.5.8 with changelog |

## What Does NOT Change

- Database trigger (`update_updated_at_column`) -- the fix is client-side, no migration needed
- Transaction manager logic
- Service worker sync (`sw-sync.js`)
- Photo sync pipeline
- RLS policies
- Soft-delete/retention system

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| Redundant re-syncs per item | Infinite (every cycle) | 0 |
| Extra SELECT per sync | 0 | 1 small query per item |
| Bandwidth waste | Re-uploads entire inspection every 30-60s | Zero after first successful sync |
| "Pending" count accuracy | Inflated by ghost re-syncs | Accurate |

## Security

- No new API keys or secrets
- The additional SELECT uses existing RLS policies
- No changes to authentication flow
