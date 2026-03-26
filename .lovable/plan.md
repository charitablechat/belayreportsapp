

## Audit: Sync Hanging on Offline-to-Online Transition

### Current State (Post-Recent Fixes)
The previous round addressed: deferred retry on debounce drop, pre-refresh session in `handleOnline`, lightweight `getCachedUserFromStorage()` gate, and reduced lock-wait timeout (35s→15s). These were good fixes. However, one significant issue remains that still causes hangs.

### Remaining Root Cause: Triple `ensureValidSession` per Sync Cycle

**File:** `src/lib/atomic-sync-manager.ts` lines 667-675 (inspections), plus equivalent blocks for trainings and assessments.

Each `syncAll*Atomic` function independently calls `ensureValidSession()`, which internally calls `supabase.auth.getSession()` — a LockManager-guarded operation with a 10-second timeout. Since `performSync` calls three atomic sync functions **sequentially**, this results in **3 separate LockManager acquisitions per sync cycle**. After `handleOnline` already refreshed the session, these calls are redundant and create the following failure mode:

1. `handleOnline` refreshes session successfully (1 LockManager call).
2. `syncAllInspectionsAtomic` → `ensureValidSession` → `getSession()` (LockManager call #2).
3. `syncAllTrainingsAtomic` → `ensureValidSession` → `getSession()` (LockManager call #3).
4. `syncAllDailyAssessmentsAtomic` → `ensureValidSession` → `getSession()` (LockManager call #4).

On slow mobile devices, the cumulative LockManager contention causes 10-30 second delays, producing the "hanging" behavior.

**The fix:** Each `syncAll*Atomic` function already passes the pre-validated `user` down to per-item `sync*Atomic()` calls (line 771). The functions just need to accept an **optional** pre-validated user parameter, skipping `ensureValidSession()` when provided.

### Secondary Issue: SW Sync Races with Main Thread

**File:** `public/sw-sync.js` line 686

The SW `sync` event handler processes ALL unsynced items with no batch limit and no coordination with the main thread's `syncInProgressRef`. After `handleOnline` sends a fresh JWT to the SW, the browser can fire a `sync` event simultaneously with the main thread's `performSync`. Both paths write to the same DB rows — the deferred `synced_at` pattern and `upsert` prevent data loss, but the duplicate work wastes bandwidth and extends the hang window.

Additionally, SW line 299 uses no drift tolerance (`updated_at > synced_at`), unlike the main thread's 2-second tolerance, causing the SW to re-process already-synced items.

### Proposed Changes

**1. Pass pre-validated user into atomic sync functions** (`src/lib/atomic-sync-manager.ts`)
- Add optional `preValidatedUser?: CachedUser` parameter to `syncAllInspectionsAtomic`, `syncAllTrainingsAtomic`, `syncAllDailyAssessmentsAtomic`.
- When provided, skip the internal `ensureValidSession()` call.
- This eliminates 3 redundant LockManager calls per cycle.

**2. Validate session once in `performSync`** (`src/hooks/useAutoSync.tsx`)
- Replace the lightweight `getCachedUserFromStorage()` check with a single `ensureValidSession()` call (with 5s timeout).
- Pass the validated user to all three `syncAll*Atomic` functions.
- Net effect: 1 auth call per cycle instead of 4.

**3. Add drift tolerance to SW sync filter** (`public/sw-sync.js`)
- Change line 299 from `new Date(i.updated_at) > new Date(i.synced_at)` to include a 2-second tolerance, matching the main thread logic.

**4. Add batch limit to SW sync** (`public/sw-sync.js`)
- Limit SW sync to 5 items per event (matching `MAX_BATCH_SIZE`), preventing long-running SW tasks from blocking the main thread's sync.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/atomic-sync-manager.ts` | Add optional `preValidatedUser` param to 3 `syncAll*` functions |
| `src/hooks/useAutoSync.tsx` | Single `ensureValidSession()` call, pass user to all sync functions |
| `public/sw-sync.js` | Add 2s drift tolerance and batch limit to sync filters |

