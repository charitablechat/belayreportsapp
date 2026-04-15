

# Sync System Edge Case Audit: Findings

## System Health: Robust with 3 Notable Gaps

After reviewing `useAutoSync.tsx` (803 lines), `atomic-sync-manager.ts` (2353 lines), `sync-reconciliation.ts`, `transaction-manager.ts`, and `useConflicts.tsx`, the sync architecture is well-engineered. Three gaps warrant attention:

---

### Gap 1: No Conflict Detection for Trainings and Daily Assessments (Medium Priority)

**Problem**: The `sync_conflicts` table and `useConflicts` hook only handle inspections. When two devices concurrently edit the same training or assessment, the system silently applies Last-Write-Wins without any conflict record. This is fine for most cases, but means there's zero visibility into concurrent training/assessment edits.

**Evidence**: `sync_conflicts` table has an `inspection_id` column. `useConflicts.tsx` only queries inspections. Searching for `sync_conflicts.*training` returns zero results.

**Recommendation**: No code change needed unless you want parity. The LWW strategy already prevents data loss — conflicts are auto-resolved. This is a monitoring gap, not a data-loss gap.

---

### Gap 2: Realtime Events Don't Pull Data into IndexedDB (Low Priority)

**Problem**: When `handleRemoteChange` fires (lines 559-593), it only invalidates React Query caches (`queryClient.invalidateQueries`). It does **not** pull the updated data into IndexedDB. This means:
- The dashboard refreshes correctly (React Query re-fetches from Supabase)
- But if the user goes offline immediately after, the IndexedDB copy is stale
- The next sync cycle will reconcile this, but there's a brief window where offline data lags

**Impact**: Only affects the narrow scenario where Device A edits → Device B receives Realtime event → Device B immediately goes offline before the next sync cycle (5-30s).

**Recommendation**: Optionally enhance `handleRemoteChange` to also save the `payload.new` data into IndexedDB. This is a minor improvement — the current behavior is acceptable for most use cases.

---

### Gap 3: Transaction Manager Is Not Truly Atomic (Known Limitation)

**Problem**: `executeTransaction()` in `transaction-manager.ts` executes steps sequentially with rollback on failure. But each step is a separate Supabase API call — not a database transaction. If the network drops mid-sync (e.g., after upserting the inspection but before child records), the data is partially committed.

**Mitigation already in place**: The `synced_at` field is only set in the **final** step, so the system knows the record needs re-syncing. The pre-sync version snapshot also provides recovery data.

**Impact**: Partial commits are self-healing — the next sync cycle will complete the remaining steps. No data loss occurs, just temporary inconsistency.

**Recommendation**: No change needed. The deferred `synced_at` pattern already handles this correctly.

---

## Confirmed Robust Areas (No Issues Found)

- **Concurrent edits on same device**: `syncInProgressRef` lock prevents duplicate sync calls
- **Rapid network toggling**: `MIN_SYNC_INTERVAL` (5s) debounce + `handleOnline` session refresh
- **Large data volumes**: `MAX_BATCH_SIZE=5` with accelerated re-sync (5s) drains queues efficiently
- **iOS bfcache**: `pageshow` event handler refreshes session before syncing
- **IndexedDB corruption**: Circuit breaker (3 failures → exponential backoff 60s-5min)
- **Self-triggered Realtime loops**: 10s post-sync cooldown prevents echo events
- **Field count regression**: >50% data drop blocks sync (3-skip override for legitimate deletions)
- **Soft-deleted record handling**: `checkRemoteRecordStatus` RPC bypasses RLS to detect deletions
- **Deduplication**: Temp-ID records checked against server by `(inspector_id, organization, created_at)` before insert

## Summary

The sync system is production-ready. The three gaps identified are edge cases with existing mitigations. No code changes are strictly necessary. If you want to address any of the gaps, Gap 2 (pulling Realtime data into IndexedDB) would provide the most tangible improvement for offline-heavy users.

