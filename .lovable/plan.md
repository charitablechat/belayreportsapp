
# Fix: Dashboard "Recent Reports" Not Loading

## Root Cause

The console logs reveal **"Atomic Sync Session validation timed out, skipping sync"** repeating in a loop. This indicates the auth session (JWT) is stale or expired. The cascade effect:

1. `getUserWithCache()` returns a cached user object, but the **Supabase client's actual JWT** is expired
2. Dashboard queries (inspections, trainings, assessments) are sent with an invalid JWT -- RLS policies block all data, returning **empty arrays**
3. `syncAllInspectionsAtomic()` calls `ensureValidSession()` which times out -- sync is skipped
4. AutoSync emits `syncComplete` even when nothing synced (line 233 in useAutoSync.tsx), which triggers Dashboard to re-load with the same broken session
5. This creates a reload loop where data never appears

The dashboard shows (0) counts and permanent skeleton loaders because the data loading functions silently return empty results.

## Fix (2 files)

### 1. `src/pages/Dashboard.tsx` -- Refresh session before loading data

Add an `ensureValidSession()` call at the start of `loadAllData` (before any Supabase queries). This refreshes the JWT if it is near expiry, ensuring RLS policies see a valid `auth.uid()`.

```
loadAllData:
  1. Call ensureValidSession() first (with a 5s timeout fallback)
  2. Then getUserWithCache() as before
  3. If BOTH fail, use getOfflineUserId() as last resort for IndexedDB-only loading
```

This ensures that even if the token needs refreshing, the dashboard will either:
- Refresh successfully and load server data
- Or fall back gracefully to IndexedDB data using the emergency userId extractor

### 2. `src/hooks/useAutoSync.tsx` -- Stop emitting syncComplete when sync was skipped

Line 232-233 emits `emitSyncComplete()` unconditionally after sync, even when all operations were skipped due to session timeouts. This triggers the Dashboard to re-load data unnecessarily (creating a loop of empty fetches).

Change: Only emit `syncComplete` when `anySuccess` is true (items were actually synced), OR when the session is valid and IndexedDB fetches succeeded. Do NOT emit when all syncs were skipped due to session validation timeouts.

## What Changes in Behavior

- Dashboard will **refresh the auth token** before querying, fixing the empty RLS results
- If token refresh fails, dashboard still shows **IndexedDB data** using the emergency userId fallback
- The sync-complete reload loop stops -- the dashboard won't repeatedly re-fetch with a broken session
- No new features added; this restores the existing intended behavior
