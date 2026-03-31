

## Comprehensive Sync & Refresh Audit — Findings

After a thorough review of `useAutoSync.tsx`, `Dashboard.tsx`, `sync-events.ts`, `cached-auth.ts`, `offline-storage.ts`, `sync-manager.ts`, and `atomic-sync-manager.ts`, here is the assessment:

---

### Areas Confirmed Working Correctly

1. **Session Recovery**: `ensureValidSession()` properly attempts `refreshSession()` when `getSession()` returns null while online. The 8s timeout and 2s retry in Dashboard are solid.

2. **Dashboard Stale Timestamp**: `markDashboardStaleTimestamp()` / `consumeDashboardStaleTimestamp()` replaces the lost DOM event pattern correctly. Report forms call it before navigating.

3. **Dual-Layer Cache**: `readDashboardCache` falls back from sessionStorage to localStorage. `writeDashboardCache` writes to both.

4. **Circuit Breaker**: Properly trips after 3 failures, uses exponential backoff, runs a probe before re-enabling, and resets `dbPromise` on recovery. The `withIndexedDBErrorBoundary` correctly resets `dbPromise` and closes stale connections on timeout (lines 596-603 of offline-storage.ts).

5. **syncPhotos race condition**: The recheck pattern (`getUnuploadedPhotos` before upload, dedup guard via `maybeSingle()`) is sound.

6. **IndexedDB timeouts**: 4s for Dashboard reads, 5s for getDB open on mobile, 5s/8s for operations — all reasonable.

7. **Event listeners**: Dashboard registers `visibilitychange`, `focus`, `online`, `pageshow`, and `onSyncComplete` — all appropriate for SPA navigation.

---

### Remaining Issue Found

**Issue: `refreshReports` useCallback has `[]` deps — stale closure risk for `loadInspections` etc.**

`refreshReports` is defined with `React.useCallback(async (force) => { ... }, [])`. Inside, it calls `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments` which are plain functions in the component body. Because the dependency array is empty, `refreshReports` captures the initial closure forever.

**Currently this is NOT an active bug** because:
- The load functions only use their arguments (`userId`, `superAdminStatus`, `sessionValid`) and call `setInspections` etc. which are stable `useState` setters
- No state variables are read directly inside `refreshReports` or the load functions

However, this is fragile. If anyone adds a state read inside these functions in the future, it will silently return stale values.

**Recommendation**: This is a code-quality concern, not a fix-now bug. The cost of changing the deps array is risk of re-render loops. Leave as-is but add a comment.

---

### Verdict

**No remaining sync or refresh bugs were found.** The recent fixes comprehensively addressed all seven identified failure modes:

- Session recovery via refresh token ✓
- 8s timeout + 2s retry ✓  
- Timestamp-based stale marking (replaces lost DOM event) ✓
- Dual-layer cache (sessionStorage + localStorage) ✓
- 4s IndexedDB timeout ✓
- `navigator.onLine` delayed recheck ✓
- Dead listener cleanup ✓
- Circuit breaker with exponential backoff and probe ✓
- Photo sync deduplication ✓
- `dbPromise` reset on timeout ✓

The synchronization and refresh system is robust. No code changes are needed at this time.

