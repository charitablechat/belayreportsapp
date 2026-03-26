

## Investigation Report: Mobile Sync Timeouts & Failures (iPad/iOS Focus)

### Executive Summary

After a deep audit of the sync pipeline (`useAutoSync`, `atomic-sync-manager`, `offline-storage`, `cached-auth`, `sw-sync.js`, `transaction-manager`), I identified **7 root causes** for persistent sync timeouts on iPad/mobile, along with **4 areas where recent fixes are validated as working correctly**.

---

### 1. Identified Root Causes

#### RC-1: IndexedDB `getAll()` Full-Table Scans on Large Stores (HIGH IMPACT)

**Problem:** Every sync cycle calls `getUnsyncedInspections/Trainings/Assessments`, each executing `db.getAll('inspections')` — loading **every record** into memory, then filtering in JS. On iPads with 50+ reports and photo blobs, this triggers the 5s timeout in `withIndexedDBErrorBoundary`.

**Evidence from logs:**
```
[Offline Storage] Operation timed out after 5000ms (7 similar warnings suppressed)
```
This appears repeatedly, and once it trips the circuit breaker (3 consecutive failures), **all IndexedDB operations fail instantly for 60 seconds**, blocking saves and sync.

**Why iPad is worse:** Safari's IndexedDB implementation is significantly slower than Chrome's, especially for large blob-containing object stores. The `photos` store with uncompressed blobs compounds this.

**Fix:** Use IndexedDB indexes (`by-synced`) instead of `getAll()` + JS filter. Query only records where `synced_at` is empty or stale, avoiding full table scans.

---

#### RC-2: Concurrent DB Connections Contending on Safari's Single-Writer Lock (HIGH)

**Problem:** Multiple subsystems open IndexedDB simultaneously:
- `useAutoSync` periodic polling (every 30-60s)
- `updateUnsyncedCounts` (every 30s via separate interval)
- `getUnsyncedCounts` (called inside `updateUnsyncedCounts`)
- Visibility change handler (fires on every tab/app switch)
- `pageshow` and `focus` handlers (iOS-specific, lines 516-531)

Safari on iPad uses a single-writer model for IndexedDB — any `readwrite` transaction blocks all other transactions. When auto-save writes overlap with sync reads, they queue behind each other, easily exceeding the 5s timeout.

**Fix:** Consolidate the two independent 30s intervals (`periodicSyncIntervalRef` and `updateUnsyncedCounts` interval) into one. Gate iOS `focus`/`pageshow` handlers behind the same `MIN_SYNC_INTERVAL` debounce.

---

#### RC-3: `getDB()` 3-Second Open Timeout Too Aggressive for iPad (MEDIUM)

**Problem:** `getDB()` (line 620-627) uses a 3-second race against `openDB()`. On iPad Safari, especially after a bfcache restore or when the app has been backgrounded, IndexedDB connection can take 3-5 seconds to re-establish. This causes `dbPromise = null` reset, and **every subsequent operation retries the open**, creating a cascade of failures.

**Fix:** Increase `getDB()` timeout to 5 seconds on mobile. Keep the `withIndexedDBErrorBoundary` outer timeout at 5-8s as the real safety net.

---

#### RC-4: Service Worker JWT Token Expiry During Background Sync (MEDIUM)

**Problem:** The SW (`sw-sync.js` lines 52-72) caches the JWT received from the main thread. When the iPad is backgrounded for >1 hour, the token expires. On resume, the SW may attempt a sync with an expired token before the main thread sends a fresh one. `getBearerToken()` returns `null`, causing the entire SW sync to silently skip.

However, the **main thread sync** (`useAutoSync`) also fires immediately on `pageshow`/`focus` — before `handleOnline` has a chance to `refreshSession()`. The `ensureValidSession` call may race against the auth refresh.

**Fix:** In the `handlePageShow` handler, await the session refresh (already done in `handleOnline`) before calling `performSync`. Currently `handlePageShow` calls `performSync(true)` directly without refreshing the session first.

---

#### RC-5: Realtime Subscription `CHANNEL_ERROR` Causing Reconnect Storms (LOW-MEDIUM)

**Evidence from logs:**
```
[AutoSync] Realtime subscription status: CHANNEL_ERROR
```
This appears repeatedly. Each CHANNEL_ERROR triggers Supabase's internal reconnection logic which, on flaky mobile connections, creates a loop of connect → error → reconnect that consumes bandwidth and CPU.

**Fix:** Add exponential backoff to the Realtime channel. If 3+ consecutive errors occur, unsubscribe and rely solely on periodic polling until stable connectivity returns.

---

#### RC-6: Sync Per-Item Work is Excessive — ~10 Network Requests Per Record (MEDIUM)

**Problem:** Each inspection sync performs:
1. `checkRemoteRecordStatus` RPC call
2. `fetchRollbackData` for 5 child tables (5 requests)
3. `reconcileAllChildTables` (1+ requests)
4. `executeTransaction` with multiple steps (5-8 requests)
5. Post-sync verification SELECT
6. `align_synced_at` RPC call
7. `getCachedProfile` (potential network)

That's **~12-15 network requests per report**. With a 5-item batch, that's 60-75 requests per sync cycle. On a mobile connection with 100-300ms RTT, this alone takes 6-22 seconds, easily exceeding the dynamic timeout.

**Fix:** For records that are confirmed new (temp-ID or no `synced_at`), skip the rollback data fetch, reconciliation, and record status check — they aren't needed for inserts.

---

#### RC-7: `withTimeout` Fallback Value Silently Swallows Errors (LOW)

**Problem:** The `withTimeout` helper (line 267) resolves with a `fallbackValue` on timeout rather than rejecting. When `getUnsyncedCounts` times out, it returns `{ inspections: [], trainings: [], assessments: [] }` — making the system believe there's nothing to sync. The user sees 0 unsynced items in the UI while data silently waits in IndexedDB.

**Fix:** When `getUnsyncedCounts` returns fallback due to timeout, set a `countsFailed` flag and show a warning badge instead of "0 unsynced."

---

### 2. Validation of Recent Fixes

| Fix | Status | Notes |
|-----|--------|-------|
| Single `ensureValidSession` per cycle | ✅ Working | Lines 132-147 in `useAutoSync` — eliminates 3 redundant LockManager calls |
| 5-item batch limit | ✅ Working | `MAX_BATCH_SIZE = 5` used consistently in both main thread and SW |
| 2s drift tolerance | ✅ Working | Lines 736-737 in `offline-storage.ts` |
| Sequential sync with `yieldToUI` | ✅ Working | Lines 217-231 in `useAutoSync` — prevents main thread blocking |
| Post-sync cooldown (10s) | ✅ Working | Lines 477-487 — prevents self-triggered Realtime loops |
| Circuit breaker pattern | ✅ Working | But trips too easily on iPad due to RC-1 and RC-2 |

---

### 3. Recommended Fixes (Priority Order)

| # | Fix | Impact | Files |
|---|-----|--------|-------|
| 1 | **Index-based unsynced queries** — replace `getAll()` + JS filter with IDB index queries | HIGH | `offline-storage.ts` |
| 2 | **Consolidate polling intervals** — merge the two 30s intervals into one | HIGH | `useAutoSync.tsx` |
| 3 | **Increase `getDB()` timeout on mobile** — 3s → 5s on iOS/iPad | MEDIUM | `offline-storage.ts` |
| 4 | **Session refresh before `pageshow` sync** — align with `handleOnline` pattern | MEDIUM | `useAutoSync.tsx` |
| 5 | **Skip rollback/status checks for new records** — reduce network calls per item | MEDIUM | `atomic-sync-manager.ts` |
| 6 | **Realtime channel error backoff** — unsubscribe after repeated errors | LOW | `useAutoSync.tsx` |
| 7 | **Surface timeout-caused zero counts** — don't show "0 unsynced" on fallback | LOW | `useAutoSync.tsx`, `offline-storage.ts` |

Shall I proceed with implementing these fixes? I'd recommend starting with fixes #1-4 as a single batch, as they address the most impactful iPad-specific issues.

