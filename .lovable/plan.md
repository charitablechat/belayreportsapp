

## S31 — Standardize drift comparison operator across `local-data-guards`

### Finding

Two call sites compare drift against `SYNC_DRIFT_TOLERANCE_MS` with **different operators**:

- `src/lib/local-data-guards.ts` L48 (`isLocalDataNewer`) uses `Math.abs(localMs - serverMs) <= SYNC_DRIFT_TOLERANCE_MS` → drift exactly equal to tolerance is treated as **within tolerance** (server wins).
- `src/lib/local-data-guards.ts` L77 (`shouldPreserveLocalRecord`) uses `drift > CLOCK_SKEW_TOLERANCE_MS` → drift exactly equal to tolerance is treated as **within tolerance** (don't preserve).
- `src/lib/offline-storage.ts` L961–977 (the unsynced-counts query referenced in the task) follows the same `>` pattern.

These are actually **already consistent in semantics** ("at exactly N ms drift, treat as synced"), but the operator choice differs (`<=` vs `>`). The task asks to standardize the wording so future readers and any new call site can't drift apart.

### Decision

Standardize on **"drift strictly greater than tolerance ⇒ unsynced"** everywhere — i.e. `>` for the "is dirty" direction, `<=` for the "within tolerance" direction. This matches the existing offline-storage query, which is the hottest path and the one most likely to be copied. A record with drift == 5000 ms (or whatever the tolerance is, currently 30000) stays "synced".

### Changes

**`src/lib/local-data-guards.ts`**

1. Extract the comparison into a single named helper so the operator lives in exactly one place:
   ```ts
   /** True when the gap between two timestamps exceeds the sync drift tolerance. */
   export function exceedsDriftTolerance(aMs: number, bMs: number): boolean {
     return Math.abs(aMs - bMs) > SYNC_DRIFT_TOLERANCE_MS;
   }
   ```
2. Rewrite `isLocalDataNewer` to use it:
   - Replace `if (Math.abs(localMs - serverMs) <= SYNC_DRIFT_TOLERANCE_MS) return false;` with `if (!exceedsDriftTolerance(localMs, serverMs)) return false;`. Behavior unchanged.
3. Rewrite `shouldPreserveLocalRecord` to use it:
   - Replace `if (drift > CLOCK_SKEW_TOLERANCE_MS) return true;` with `if (exceedsDriftTolerance(updatedMs, syncedMs)) return true;` (computing `updatedMs`/`syncedMs` from the record, removing the `drift` local since it's now subsumed). Behavior unchanged for positive drift; for negative drift (synced_at > updated_at, possible after Part B server-anchored timestamps) the new version correctly treats large negative drift as a clock anomaly worth preserving — a small consistency win.
4. Drop the deprecated `CLOCK_SKEW_TOLERANCE_MS` alias (now unused after the rewrite).

**`src/lib/offline-storage.ts` L961–977**

5. Replace the inline `Math.abs(...) > SYNC_DRIFT_TOLERANCE_MS` comparison in the unsynced-counts query with `exceedsDriftTolerance(...)` imported from `local-data-guards`. Single source of truth; no behavior change (already uses `>`).

**Tests (`src/lib/local-data-guards.test.ts`)**

6. Add three boundary cases to lock in the contract:
   - drift == tolerance ⇒ `isLocalDataNewer` returns `false`, `shouldPreserveLocalRecord` returns `false`.
   - drift == tolerance + 1 ⇒ both return `true`.
   - drift == tolerance - 1 ⇒ both return `false`.

### Out of scope

- Changing the tolerance value itself (still 30 s, per the existing comment block).
- Auditing other places that compute timestamp diffs for unrelated purposes (sync-reconciliation cooldowns, photo retention, etc.) — different semantics.
- Changing the symmetric/absolute-value choice (still `Math.abs`; negative-drift handling was clarified above as a small win, not a behavior reversal in any real case).

### Risk

Negligible. Pure refactor of a comparison operator into a shared helper; the only behavioral change is for the exact-equality boundary case, which is now uniformly "treat as synced" everywhere. No data-path change.

### Verification

- `npx tsc --noEmit`.
- `npx vitest run src/lib/local-data-guards.test.ts` (existing + 3 new boundary cases pass).
- Grep `SYNC_DRIFT_TOLERANCE_MS` confirms no remaining inline comparisons outside `exceedsDriftTolerance`.

