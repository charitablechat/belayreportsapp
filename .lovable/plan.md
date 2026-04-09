

# Complete Sync Engine Audit — Remaining Gaps

After a thorough review of `atomic-sync-manager.ts`, `useAutoSync.tsx`, `transaction-manager.ts`, `sync-reconciliation.ts`, and `offline-storage.ts`, here are all remaining issues that could stop or slow down syncing.

---

## BUG 1: `isNewRecord` logic for inspections is broken (HIGH — causes unnecessary slowdown)

**File**: `src/lib/atomic-sync-manager.ts`, line 254

```js
const isNewRecord = !inspection.synced_at && !inspectionIdMapping?.oldId?.startsWith('temp-') === false;
```

Due to JS operator precedence, `!x === false` evaluates as `(!x) === false`, not `!(x === false)`. This means:

- **Non-temp inspections with no `synced_at`** (e.g., a new inspection created online with a real UUID): `isNewRecord` evaluates to `false`, so it makes an unnecessary `checkRemoteRecordStatus` RPC call + 5 rollback fetches (~6 extra network requests)
- Trainings (line 1048) and assessments (line 1745) use the correct `!training.synced_at` — only inspections have this bug

**Fix**: Replace with `const isNewRecord = !inspection.synced_at;` (same as trainings/assessments). The temp-ID mapping is already handled separately.

---

## BUG 2: `getUnsyncedInspections` uses `getAll()` full-table scan (MEDIUM — Safari timeouts)

**File**: `src/lib/offline-storage.ts`, line 906

The memory documents that index-based queries (`by-synced`) should be used instead of `getAll()` to avoid Safari's 5-second timeout on large stores. But `getUnsyncedInspections` (and the training/assessment equivalents) still do:

```js
const allInspections = await db.getAll('inspections');
let unsynced = allInspections.filter(...)
```

This loads **all** records into memory, then filters client-side. For users with 100+ records, this can trigger Safari's IDB timeout and cause the circuit breaker to trip, blocking all syncing.

The `getUnsyncedCounts` (line 1982) has the same issue — it calls `getAll()` on all three stores sequentially.

**Fix**: Use the `by-synced` index to query only unsynced records directly from IndexedDB, avoiding the full scan.

---

## GAP 3: Sequential sync across all 3 types (MEDIUM — slowdown)

**File**: `src/hooks/useAutoSync.tsx`, lines 245-251

Inspections, trainings, and assessments are synced sequentially:
```js
const inspResult = await syncAllInspectionsAtomic(validatedUser);
await yieldToUI();
const trainResult = await syncAllTrainingsAtomic(validatedUser);
await yieldToUI();
const assessResult = await syncAllDailyAssessmentsAtomic(validatedUser);
```

If a user has 5 inspections + 5 trainings + 5 assessments (15 items), these process sequentially across types. Since they hit different tables with no shared state, they could be parallelized at the type level (while keeping per-item serialization within each type).

However, this is intentionally sequential to avoid overwhelming mobile connections — **recommend keeping as-is** with a note. This is not a bug.

---

## GAP 4: `field_count_regression` guard has no escape hatch (LOW — potential stuck loop)

**File**: `src/lib/atomic-sync-manager.ts`, lines 366-381, 1111-1128, 1808-1825

If a record's field count drops >50% (e.g., user legitimately deletes most child rows), the sync is permanently blocked with `skipped: true, reason: 'field_count_regression'`. Like the old `suspicious_empty_guard`, this has no max-skip counter. A record caught by this guard will be retried and skipped every cycle indefinitely.

**Fix**: Add a skip counter (in-memory Map) — after 3 consecutive skips for the same record, allow the sync to proceed. The version snapshot already captures pre-sync state for recovery.

---

## Summary of Proposed Changes

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `src/lib/atomic-sync-manager.ts` (line 254) | Fix `isNewRecord` operator precedence bug | HIGH |
| 2 | `src/lib/offline-storage.ts` | Replace `getAll()` with index-based queries for unsynced detection | MEDIUM |
| 3 | `src/lib/atomic-sync-manager.ts` | Add skip counter to `field_count_regression` guard | LOW |

