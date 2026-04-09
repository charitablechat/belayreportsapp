

# Sync Performance Gaps Analysis

## Finding 1: Inspection & Training `suspicious_empty_guard` still blocks permanently (HIGH)

**Location**: `src/lib/atomic-sync-manager.ts` lines 483-491 (inspections) and 1217-1224 (trainings)

The assessment version of this guard was just fixed to allow genuinely blank forms through, but the **inspection** and **training** versions still have the old blocking behavior — they return `{ skipped: true }` unconditionally when a record is edited, empty, and older than 5 minutes. This means any legitimately blank inspection or training will be permanently stuck in the same infinite skip loop that was just fixed for assessments.

**Fix**: Apply the same logic from the assessment guard — check whether the server also has no child data before blocking. If Guard 1 (`empty_local_guard`) already ran and didn't block, it means the server is also empty, so the record is genuinely blank and should sync.

---

## Finding 2: Per-item network request count is very high (MEDIUM — performance)

Each **existing** record sync makes a large number of sequential network requests:

1. `checkRemoteRecordStatus` RPC — 1 request
2. `fetchRollbackData` for each child table — **5-6 requests** (inspections: 5, trainings: 6, assessments: 6)
3. `reconcileAllChildTables` fetches server rows for each child table — **another 5-6 requests** (each calls `select('*')`)
4. `executeTransaction` — 1 upsert per parent + 1 per non-empty child table + 1 final update = **3-8 requests**
5. Post-transaction verification SELECT — 1 request
6. `align_synced_at` RPC — 1 request
7. Queue cleanup — 1 request

**Total per existing record: ~18-28 network requests**, all sequential. With a batch of 5 items, that's **90-140 requests per sync cycle**.

The `fetchRollbackData` calls (Guard 1) and `reconcileAllChildTables` both fetch the same server child data independently — this is a redundant double-fetch.

**Fix**: Pass the already-fetched server child data from Guard 1 into the reconciliation step, eliminating 5-6 duplicate fetches per record. This alone cuts per-item requests by ~25%.

---

## Finding 3: Reconciliation does N+1 deletes (LOW — performance)

`reconcileChildTable` in `sync-reconciliation.ts` fetches all server rows, computes orphans, then deletes them **one by one** (implied by the individual `.delete()` calls per orphan row). For records with many deleted child rows, this creates many small requests.

**Fix**: Batch orphan deletes using `.in('id', orphanIds)` instead of individual calls.

---

## Summary of Proposed Changes

| File | Change | Priority |
|------|--------|----------|
| `src/lib/atomic-sync-manager.ts` (lines 483-491) | Apply server-aware suspicious_empty_guard to inspections (match assessment pattern) | HIGH |
| `src/lib/atomic-sync-manager.ts` (lines 1217-1224) | Apply server-aware suspicious_empty_guard to trainings (match assessment pattern) | HIGH |
| `src/lib/atomic-sync-manager.ts` (all 3 sync functions) | Pass Guard 1 fetched data to reconciliation to eliminate duplicate fetches | MEDIUM |
| `src/lib/sync-reconciliation.ts` | Batch orphan deletes with `.in()` instead of individual calls | LOW |

