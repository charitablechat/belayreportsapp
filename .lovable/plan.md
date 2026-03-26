

## Root Cause Analysis: Reports Hanging After Offline-to-Online Transition

### Finding 1: Online Reconnection Sync Silently Dropped (HIGH)

**File:** `src/hooks/useAutoSync.tsx`, lines 155-161

When the browser fires the `online` event, `handleOnline` calls `performSync(false)`. But `performSync` has a `MIN_SYNC_INTERVAL` (5 seconds) debounce guard that **silently returns** if another sync attempt happened recently (e.g., from `visibilitychange` which often fires simultaneously with `online`).

The critical issue: when the sync is dropped, **no retry is scheduled**. The user must wait for the next periodic poll (30s desktop / 60s mobile) before sync is attempted again. This creates the "hanging" perception.

**Fix:** When the debounce guard triggers during an explicit online reconnection (`silent = false`), schedule a deferred retry instead of silently returning.

### Finding 2: Expired JWT After Extended Offline Period (HIGH)

**File:** `src/lib/cached-auth.ts`, lines 297-301

`getCachedUserFromStorage()` checks `expiresAt` when online and returns `null` if expired. After a long offline period, the JWT is always expired. The `performSync` flow calls `getUserWithCache()` at line 124 — which hits `getCachedUserFromStorage()` first. If the token is expired and the fast path returns `null`, it falls through to the slow path (`supabase.auth.getUser()`) which can fail or timeout.

Meanwhile, `ensureValidSession()` (called inside `syncAllInspectionsAtomic`) also tries `getSession()` → refresh. If both race, we get duplicate auth calls competing for the Supabase lock manager, causing `LockManager` timeouts.

**Fix:** In `handleOnline`, explicitly refresh the session **before** calling `performSync`. This ensures all downstream callers get a fresh token.

### Finding 3: `syncInProgressRef` Deadlock on Auth Timeout (MEDIUM)

**File:** `src/hooks/useAutoSync.tsx`, lines 133-151

When `performSync` is already running (from the `online` handler), subsequent callers enter a polling loop that waits up to 35 seconds for the lock to release. If the first sync hangs on auth validation (5s timeout in `ensureValidSession`), plus IndexedDB reads (15s timeout), the combined duration can approach the 35s safety limit. During this window, no new syncs execute, creating the "stuck" appearance.

**Fix:** Reduce the wait-for-lock timeout and add an early exit if the first sync is stuck in auth validation.

### Finding 4: Double Auth Validation per Sync Cycle (LOW)

**File:** `src/hooks/useAutoSync.tsx` line 124 and `src/lib/atomic-sync-manager.ts` line 668

`performSync` calls `getUserWithCache()` to gate the sync. Then `syncAllInspectionsAtomic` calls `ensureValidSession()` with its own 5s timeout. This means every sync cycle runs two separate auth checks — the second one can trigger a `LockManager` timeout if the first already consumed the lock.

**Fix:** Pass the validated user from `performSync` into the atomic sync functions, or skip the top-level auth check since each atomic function already validates.

---

### Implementation Plan

**1. Fix silent sync drop on reconnection** (`src/hooks/useAutoSync.tsx`)
- In `performSync`, when `MIN_SYNC_INTERVAL` guard fires and `silent === false`, schedule a `setTimeout` retry after `MIN_SYNC_INTERVAL` remaining time instead of returning void.

**2. Pre-refresh session in `handleOnline`** (`src/hooks/useAutoSync.tsx`)
- Before calling `performSync`, call `supabase.auth.refreshSession()` with a 5s timeout to ensure a fresh JWT is available for all downstream sync operations.
- This eliminates the race between `getUserWithCache` and `ensureValidSession`.

**3. Remove redundant top-level auth check** (`src/hooks/useAutoSync.tsx`)
- Remove the `getUserWithCache()` gate at line 124 in `performSync`. Each `syncAll*Atomic` function already calls `ensureValidSession()` which is more thorough.
- Keep a lightweight check using `getCachedUserFromStorage()` (sync, no network) just to skip when clearly not logged in.

**4. Reduce lock-wait timeout** (`src/hooks/useAutoSync.tsx`)
- Reduce the "wait for sync in progress" polling timeout from 35s to 15s. If a sync is stuck for 15s, the waiting caller should proceed to schedule a new attempt rather than blocking.

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useAutoSync.tsx` | Fix silent drop on reconnect; pre-refresh session in handleOnline; replace blocking auth check with sync cache read; reduce lock-wait timeout |

