## Real root cause (corrected)

The diagnostic proves it:

- `idb.getDB timed out after 3000ms` — IndexedDB connection can't open at all
- `photos.getPhotoRetryBuckets timed out after 5000ms` — same wedge, downstream
- `syncEngine.halt = circuit_breaker_open / COOLDOWN` — auto-resume in ~3 min
- `JWT_FAIL: Failed to send a request to the Edge Function` — Self-Check can't reach the network either, but `navigator.onLine = true`
- 57 inspections + 21 trainings + 9 daily assessments stranded
- Platform: **Win32 / Chrome 148** (not iPad — earlier assumption was wrong)
- Console shows `[vite] server connection lost. Polling for restart...` and Realtime `CHANNEL_ERROR`

When `getDB()` itself hangs, every retry burns its full 5-15s budget, the per-op breaker trips into the 1-4 min cooldown, and the Sync Terminal becomes the only escape — but its Retry button just calls `forceSync()` which re-enters the same wedge.

The most common causes of an `openDB` hang on desktop Chrome:

1. **Another tab of the same app holds an open v19 connection**, blocking a transaction the new caller wants. The existing `blocked()` handler asks the SW to release its handle, but does NOT ask other tabs to close, and `navigator.serviceWorker.ready` inside `blocked()` can itself hang indefinitely.
2. **Stale service worker** holding an IDB handle that won't release.
3. **Cached `dbPromise` resolved to a connection whose underlying DB was force-closed** by the browser or another tab — every subsequent `await getDB()` then times out on the first transaction.

## Plan

### 1. Make `getDB()` self-heal when wedged

In `src/lib/offline-storage.ts`:

- When `getDB()` rejects with "IndexedDB open timed out", clear `dbPromise`, attempt one quick recovery pass: close the previously cached handle if any, then retry `openDB` once with a short budget. Only after that second failure do we surface the timeout.
- Bound the `navigator.serviceWorker.ready` await inside the `blocked()` handler with a 1500 ms timeout — it must never extend the open budget.
- When the per-op layer breaker is open AND the diagnostic shows `idb.error`, expose a `forceCloseAndReopenDB()` helper that:
  - Sets `dbPromise = null`
  - Calls `db.close()` on any cached handle reachable through the in-flight promise
  - Resets `layerBreakerConsecutiveTimeouts` and `circuitBreaker.byStore`
  - Re-runs one `openDB` with the upgrade-grade timeout

### 2. Add a real recovery button to the Sync Terminal

In `src/components/pwa/SyncPulse.tsx`:

- New top-level "RECOVER STORAGE" action visible only when `haltState.code === 'circuit_breaker_open'` OR the last diagnostic shows `idb.error`.
- The button:
  1. Calls `forceCloseAndReopenDB()`.
  2. Unregisters the active service worker if present (`navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`) and posts a `CLOSE_IDB_FOR_UPGRADE` message first so the SW releases its IDB handle cleanly.
  3. Calls `clearAllQuarantines()` and `resetLayerBreakerOnUserActivity('manual recover')`.
  4. Triggers a fresh `forceSync()`.
  5. If the open still fails, surfaces a clear message: "Close any other browser tabs of this app, then tap Recover again." This is the single most common cause of a persistent open block, and we currently don't tell the user.

### 3. Detect and warn about multi-tab blocking

- In the existing `blocked()` handler, after the SW ping, set a 3 s deadline. If `getDB()` hasn't resolved by then, dispatch a `sync-multi-tab-block` event. `SyncPulse` listens and shows an amber banner: "Another tab of this app is blocking sync. Close other tabs to continue."

### 4. Diagnostic improvements

- Surface in the diagnostic JSON: `idb.openMs` for the failed attempt, `idb.dbHandleCached` (was `dbPromise` set?), and `serviceWorker: { controller, registrations: count }`. This lets us confirm the SW-vs-tab cause from a single copy/paste in future support sessions.

### 5. Verify

- Browser-test the recovery button at desktop width (Windows-style 1332×1882 viewport already present), confirming:
  - Button only appears when wedged
  - After tap, status flips out of COOLDOWN within 3 s on a healthy DB
  - On a still-blocked DB, the multi-tab warning surfaces
- Re-run the diagnostic before/after to confirm `idb.readable: true`.

### Out of scope (intentionally not changing)

- IDB timeout values (already tuned per-tier)
- Sync engine batching / drain order — those work fine once the DB handle is healthy
- Any RLS / edge function logic — JWT_FAIL here is a downstream symptom of the IDB wedge, not an auth defect

### Files touched

- `src/lib/offline-storage.ts` — bounded SW await, `forceCloseAndReopenDB()`, multi-tab block event
- `src/components/pwa/SyncPulse.tsx` — RECOVER STORAGE button + multi-tab banner + listener
- `src/lib/sync-diagnostic-probe.ts` — extra fields (`dbHandleCached`, SW info)